import { describe, expect, it } from "vitest";
import {
  drainQueue,
  runNextJob,
  type FinishJobInput,
  type ImportJob,
  type JobQueue,
  type JobRunnerOptions,
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

/**
 * An in-memory queue, so the runner's behaviour can be tested without a database.
 *
 * It models `import_finish_job` rather than merely recording calls, because charging now happens
 * *inside* finish and a fake that ignored that would test nothing about the thing that changed.
 * The allowance, the stamp that makes a second finish free, and the refusal that turns a success
 * into a failure all behave as the SQL does.
 */
interface FakeQueue extends JobQueue {
  finished: FinishJobInput[];
  /** one entry per unit actually spent */
  charges: string[];
}

function fakeQueue(
  jobs: ImportJob[],
  allowance: { limit?: number; entitled?: boolean } = {},
): FakeQueue {
  const limit = allowance.limit ?? Infinity;
  const entitled = allowance.entitled ?? true;
  const pending = [...jobs];
  const finished: FinishJobInput[] = [];
  const charges: string[] = [];
  // keyed by job id, as `import_jobs.quota_consumed_at` is
  const consumed = new Map(jobs.filter((j) => j.quotaConsumedAt).map((j) => [j.id, true]));

  return {
    finished,
    charges,
    async claim() {
      return pending.shift() ?? null;
    },
    async finish(input) {
      finished.push(input);
      if (input.status !== "review" || !input.charge || consumed.has(input.jobId)) {
        return { recorded: input.status, charged: false, quota: null };
      }
      if (!entitled) return { recorded: "failed", charged: false, quota: "no-entitlement" };
      if (charges.length >= limit) return { recorded: "failed", charged: false, quota: "exceeded" };
      charges.push(input.jobId);
      consumed.set(input.jobId, true);
      return { recorded: "review", charged: true, quota: null };
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
          return { storagePath: `fam-1/${input.photoId}.jpg`, width: 800, height: 600 };
        },
      }),
    );
    expect(stored).toEqual([{ photoId: "job-1" }]);
    expect(outcome.status === "review" && outcome.result.photo).toEqual({
      storagePath: "fam-1/job-1.jpg",
      width: 800,
      height: 600,
    });
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
  /**
   * Charged when the result is recorded, not when the job is claimed.
   *
   * The reversal is measured rather than theoretical: on a batch of twenty-two pasted links,
   * ten of the fifteen that reached the queue failed to fetch, so charging up front spent two
   * thirds of the allowance on nothing. Decisions §32 keeps the old reasoning and why it lost.
   */
  it("charges nothing for a job that failed", async () => {
    const queue = fakeQueue([job({ inputRef: NOTHING })]);
    const outcome = await runNextJob(
      options({ queue, imports: { fetcher: createFakeFetcher({ [NOTHING]: { html: PAGE_WITH_NO_RECIPE } }) } }),
    );

    expect(outcome.status).toBe("failed");
    expect(queue.charges, "a page that published no recipe cost us almost nothing").toEqual([]);
    expect(queue.finished[0]?.charge).toBe(false);
  });

  it("charges nothing when the site refuses the request", async () => {
    // the common case, and the one that made this worth reversing: link rot and bot-blocking
    const queue = fakeQueue([job({ inputRef: "https://example.com/gone" })]);
    const outcome = await runNextJob(
      options({
        queue,
        // no fixture for that URL: the fake fetcher throws, as a 404 does
        imports: { fetcher: createFakeFetcher({}) },
      }),
    );

    expect(outcome.status).toBe("failed");
    expect(queue.charges).toEqual([]);
    // the flag, not just the total: a failed status is never charged by the database either,
    // so asserting only the total would pass without the runner deciding anything
    expect(queue.finished[0]?.charge).toBe(false);
  });

  it("charges exactly one for a job that succeeded", async () => {
    const queue = fakeQueue([job()]);
    const outcome = await runNextJob(options({ queue }));

    expect(outcome.status).toBe("review");
    expect(queue.charges).toEqual(["job-1"]);
    expect(queue.finished[0]?.charge).toBe(true);
  });

  it("charges once in total for a job that succeeds after failing", async () => {
    // a transient refusal, then the same job re-claimed once its lease expired
    const flaky = createFakeFetcher({});
    const queue = fakeQueue([job(), job({ attempts: 2 })]);

    const first = await runNextJob(options({ queue, imports: { fetcher: flaky } }));
    const second = await runNextJob(options({ queue, imports: { fetcher: fetcher() } }));

    expect(first.status).toBe("failed");
    expect(second.status).toBe("review");
    expect(queue.charges, "the failed attempt was free; the successful one paid once").toEqual([
      "job-1",
    ]);
  });

  it("does not charge again for a job already stamped as paid", async () => {
    // a crash between spending and recording cannot happen — they are one statement — but a
    // job re-claimed after its lease expired can be finished twice
    const queue = fakeQueue([job({ attempts: 2, quotaConsumedAt: "2026-08-12T00:00:00.000Z" })]);
    const outcome = await runNextJob(options({ queue }));

    expect(outcome.status).toBe("review");
    expect(queue.charges).toEqual([]);
  });

  it("costs nothing when the URL is already cached", async () => {
    const cache = createFakeCache();
    const shared = fetcher();

    const first = fakeQueue([job()]);
    await runNextJob(options({ queue: first, imports: { fetcher: shared, cache } }));
    expect(first.charges).toHaveLength(1);

    // a second household importing the same link costs no fetch and no parse, so no allowance
    const second = fakeQueue([job({ id: "job-2", familyId: "fam-2" })]);
    const outcome = await runNextJob(
      options({ queue: second, imports: { fetcher: fetcher(), cache } }),
    );

    expect(second.charges).toEqual([]);
    expect(second.finished[0]?.charge).toBe(false);
    expect(outcome.status === "review" && outcome.result.fromCache).toBe(true);
  });

  it("fails a success the household cannot pay for, rather than giving it away", async () => {
    // the meter is the only thing between an allowance and ignoring it
    const queue = fakeQueue([job()], { limit: 0 });
    const outcome = await runNextJob(options({ queue }));

    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.failure).toEqual({
      kind: "quota-exceeded",
      reason: "exceeded",
    });
  });

  it("tells a household with no allowance apart from one that has used it up", async () => {
    const queue = fakeQueue([job()], { entitled: false });
    const outcome = await runNextJob(options({ queue }));

    expect(outcome.status === "failed" && outcome.failure).toEqual({
      kind: "quota-exceeded",
      reason: "no-entitlement",
    });
  });

  it("still fetches before it knows whether it can charge", async () => {
    // stated rather than hidden: charging late means an out-of-allowance household causes a
    // request before being refused. The trade accepted in §32.
    const spy = fetcher();
    const queue = fakeQueue([job()], { limit: 0 });
    await runNextJob(options({ queue, imports: { fetcher: spy } }));

    expect(spy.pageCalls).toEqual([PIE]);
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
