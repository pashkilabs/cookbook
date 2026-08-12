import { describe, expect, it } from "vitest";
import {
  drainQueue,
  runNextJob,
  type FinishJobInput,
  type ImportJob,
  type JobQueue,
  type JobRunnerOptions,
  type QuotaMeter,
  type QuotaVerdict,
} from "../src/index.js";
import {
  PAGE_WITH_IMAGE_REFERENCE,
  PAGE_WITH_NO_RECIPE,
  createFakeCache,
  createFakeFetcher,
  jpegBytes,
} from "./fixtures.js";

const PIE = "https://example.com/pie";
const IMAGE = "https://cdn.example.com/pie.jpg";
const NOTHING = "https://example.com/about";

/** An in-memory queue, so the runner's behaviour can be tested without a database. */
function fakeQueue(jobs: ImportJob[]): JobQueue & { finished: FinishJobInput[]; marked: string[] } {
  const pending = [...jobs];
  const finished: FinishJobInput[] = [];
  const marked: string[] = [];
  return {
    finished,
    marked,
    async claim() {
      return pending.shift() ?? null;
    },
    async finish(input) {
      finished.push(input);
    },
    async markQuotaConsumed(jobId) {
      marked.push(jobId);
    },
  };
}

function fakeQuota(verdict: QuotaVerdict = { allowed: true }): QuotaMeter & { calls: Array<[string, number]> } {
  const calls: Array<[string, number]> = [];
  return {
    calls,
    async consume(familyId, amount) {
      calls.push([familyId, amount]);
      return verdict;
    },
  };
}

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: "job-1",
  familyId: "fam-1",
  kind: "url",
  inputRef: PIE,
  attempts: 1,
  quotaConsumedAt: null,
  ...over,
});

const fetcher = () =>
  createFakeFetcher({ [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } }, { [IMAGE]: { bytes: jpegBytes() } });

function options(over: Partial<JobRunnerOptions> = {}): JobRunnerOptions {
  return {
    queue: fakeQueue([job()]),
    quota: fakeQuota(),
    worker: "test-worker",
    imports: { fetcher: fetcher() },
    ...over,
  };
}

describe("running a job", () => {
  it("finishes in review, not saved — no import saves unseen", async () => {
    const queue = fakeQueue([job()]);
    const outcome = await runNextJob(options({ queue }));

    expect(outcome.status).toBe("review");
    expect(queue.finished[0]).toMatchObject({ jobId: "job-1", status: "review" });
    // the runner creates no recipe rows at all; that happens when somebody accepts
    if (outcome.status !== "review") return;
    expect(outcome.result.recipe.title).toBe("Apple Pie");
  });

  it("records which tier answered", async () => {
    const outcome = await runNextJob(options());
    expect(outcome.status === "review" && outcome.result.tier).toBe("structured-data");
  });

  it("reports idle on an empty queue rather than spinning", async () => {
    expect(await runNextJob(options({ queue: fakeQueue([]) }))).toEqual({ status: "idle" });
  });

  it("stores the photo under the job id, so a retry replaces it", async () => {
    const stored: Array<{ photoId: string }> = [];
    const outcome = await runNextJob(
      options({
        storePhoto: async (input) => {
          stored.push({ photoId: input.photoId });
          return `fam-1/${input.photoId}.jpg`;
        },
      }),
    );
    expect(stored).toEqual([{ photoId: "job-1" }]);
    expect(outcome.status === "review" && outcome.result.photoPath).toBe("fam-1/job-1.jpg");
  });

  it("drains pasted text through tier 2", async () => {
    const provider = {
      key: "stub",
      async extract() {
        return {
          json: {
            title: "Pasted Carbonara",
            servings: 2,
            totalMinutes: 20,
            ingredientLines: ["1 lb spaghetti"],
            steps: ["Boil."],
          },
          usage: { model: "m1" },
        };
      },
    };
    const outcome = await runNextJob(
      options({
        queue: fakeQueue([job({ kind: "text", inputRef: "1 lb spaghetti\n4 egg yolks" })]),
        imports: {
          fetcher: createFakeFetcher({}),
          llm: { provider, models: [{ provider: "x", model: "m1", region: "us" }] },
        },
      }),
    );
    expect(outcome.status === "review" && outcome.result.tier).toBe("llm");
  });
});

describe("typed terminal states", () => {
  it("records the import failure itself, not a sentence about it", async () => {
    const queue = fakeQueue([job({ inputRef: "https://www.instagram.com/p/abc/" })]);
    const outcome = await runNextJob(options({ queue }));

    expect(outcome.status).toBe("failed");
    const recorded = queue.finished[0]!;
    expect(recorded.status).toBe("failed");
    expect(recorded.result).toEqual({
      ok: false,
      failure: {
        kind: "blocked-platform",
        url: "https://www.instagram.com/p/abc/",
        platform: "Instagram",
        useInstead: "screenshot",
      },
    });
    // a UI can branch on that; it could not branch on a message
    if (recorded.result.ok) return;
    expect(recorded.result.failure.kind).toBe("blocked-platform");
  });

  it("records a page with no recipe as such", async () => {
    const queue = fakeQueue([job({ inputRef: NOTHING })]);
    await runNextJob(
      options({ queue, imports: { fetcher: createFakeFetcher({ [NOTHING]: { html: PAGE_WITH_NO_RECIPE } }) } }),
    );
    const recorded = queue.finished[0]!.result;
    expect(recorded.ok).toBe(false);
    if (!recorded.ok) expect(recorded.failure.kind).toBe("no-recipe-found");
  });

  it("refuses a kind it does not drain, rather than leaving it queued forever", async () => {
    for (const kind of ["screenshot", "video"] as const) {
      const queue = fakeQueue([job({ kind })]);
      const outcome = await runNextJob(options({ queue }));
      expect(outcome.status, kind).toBe("failed");
      const recorded = queue.finished[0]!.result;
      if (recorded.ok) throw new Error("expected failure");
      expect(recorded.failure).toEqual({ kind: "unsupported-job-kind", jobKind: kind });
    }
  });

  it("never throws for an expected condition", async () => {
    const cases: ImportJob[] = [
      job({ inputRef: "not a url" }),
      job({ inputRef: "https://www.facebook.com/x" }),
      job({ kind: "text", inputRef: "some text" }), // no model configured
    ];
    for (const claimable of cases) {
      const queue = fakeQueue([claimable]);
      await expect(runNextJob(options({ queue })), claimable.inputRef).resolves.toBeDefined();
      expect(queue.finished[0]?.status, claimable.inputRef).toBe("failed");
    }
  });
});

describe("quota", () => {
  it("spends one unit per job, through the meter", async () => {
    const quota = fakeQuota();
    await runNextJob(options({ quota }));
    expect(quota.calls).toEqual([["fam-1", 1]]);
  });

  it("records that it spent, so a retry does not charge twice", async () => {
    const queue = fakeQueue([job()]);
    await runNextJob(options({ queue }));
    expect(queue.marked).toEqual(["job-1"]);
  });

  it("does not charge again for a job that already paid", async () => {
    const quota = fakeQuota();
    // a retry after a crash: the row still carries the timestamp
    await runNextJob(
      options({
        queue: fakeQueue([job({ attempts: 2, quotaConsumedAt: "2026-08-12T00:00:00.000Z" })]),
        quota,
      }),
    );
    expect(quota.calls).toEqual([]);
  });

  it("costs nothing when the URL is already cached", async () => {
    const cache = createFakeCache();
    const quota = fakeQuota();
    const shared = fetcher();

    // first job pays and populates the cache
    await runNextJob(options({ queue: fakeQueue([job()]), quota, imports: { fetcher: shared, cache } }));
    expect(quota.calls).toHaveLength(1);

    // a second household importing the same link costs no model call, so no quota
    const second = fakeQuota();
    const outcome = await runNextJob(
      options({
        queue: fakeQueue([job({ id: "job-2", familyId: "fam-2" })]),
        quota: second,
        imports: { fetcher: createFakeFetcher({}), cache },
      }),
    );
    expect(second.calls).toEqual([]);
    expect(outcome.status === "review" && outcome.result.fromCache).toBe(true);
  });

  it("fails the job when the household is out of allowance", async () => {
    const queue = fakeQueue([job()]);
    const outcome = await runNextJob(
      options({ queue, quota: fakeQuota({ allowed: false, reason: "exceeded", detail: "50 of 50 used" }) }),
    );
    expect(outcome.status).toBe("failed");
    const recorded = queue.finished[0]!.result;
    if (recorded.ok) throw new Error("expected failure");
    expect(recorded.failure).toEqual({
      kind: "quota-exceeded",
      reason: "exceeded",
      detail: "50 of 50 used",
    });
  });

  it("does not fetch anything when quota is refused", async () => {
    const spy = fetcher();
    await runNextJob(
      options({
        quota: fakeQuota({ allowed: false, reason: "no-entitlement" }),
        imports: { fetcher: spy },
      }),
    );
    expect(spy.pageCalls).toEqual([]);
  });
});

describe("draining", () => {
  it("runs until the queue is empty", async () => {
    const queue = fakeQueue([
      job({ id: "a" }),
      job({ id: "b" }),
      job({ id: "c" }),
    ]);
    const outcomes = await drainQueue({ ...options({ queue }), queue });
    expect(outcomes.map((o) => o.status)).toEqual(["review", "review", "review"]);
    expect(queue.finished.map((f) => f.jobId)).toEqual(["a", "b", "c"]);
  });

  it("stops at maxJobs, so a route can return inside its timeout", async () => {
    const queue = fakeQueue(Array.from({ length: 10 }, (_, i) => job({ id: `j${i}` })));
    const outcomes = await drainQueue({ ...options({ queue }), queue, maxJobs: 4 });
    expect(outcomes).toHaveLength(4);
  });
});
