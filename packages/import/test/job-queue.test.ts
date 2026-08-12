import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "@pashki/db/test-support";
import { createQuotaMeter } from "@pashki/platform-client";
import { createSupabasePlatformStore } from "@pashki/platform-client/supabase";
import type { PlatformStore } from "@pashki/platform-client";
import { drainQueue, runNextJob, type QuotaMeter } from "../src/index.js";
import { createSupabaseJobQueue } from "../src/supabase-job-queue.js";
import { PAGE_WITH_IMAGE_REFERENCE, createFakeFetcher, jpegBytes } from "./fixtures.js";

/**
 * The queue against a real Postgres.
 *
 * The in-memory queue proves the runner's logic; this proves the claim is genuinely
 * atomic, which is the one thing a fake cannot show — a single-threaded stub hands out
 * each job once for free.
 */
const instance = readLocalInstance();
const IMAGE = "https://cdn.example.com/pie.jpg";

describe.skipIf(instance === null)("import job queue", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  let quota: QuotaMeter;
  let store: PlatformStore;

  /** Read the balance through the seam, not by querying the table. */
  const quotaUsed = async (): Promise<number> => {
    const entitlement = await store.findEntitlement(household.familyId, "recipes");
    return entitlement?.quota.imports?.used ?? -1;
  };

  /** A fetcher that serves every job's URL, so nothing touches the network. */
  const fetcherFor = (urls: string[]) =>
    createFakeFetcher(
      Object.fromEntries(urls.map((url) => [url, { html: PAGE_WITH_IMAGE_REFERENCE }])),
      { [IMAGE]: { bytes: jpegBytes() } },
    );

  async function queueJobs(count: number, prefix: string): Promise<string[]> {
    const urls = Array.from({ length: count }, (_, i) => `https://example.com/${prefix}-${i}`);
    const { error } = await admin.from("import_jobs").insert(
      urls.map((url) => ({
        family_id: household.familyId,
        kind: "url",
        input_ref: url,
        status: "queued",
      })),
    );
    if (error) throw error;
    return urls;
  }

  const jobRows = async () => {
    const { data, error } = await admin
      .from("import_jobs")
      .select("id, input_ref, status, attempts, quota_consumed_at, worker, result_json")
      .eq("family_id", household.familyId);
    if (error) throw error;
    return data;
  };

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "queue",
    });
    // the real meter, wired the way a route would: quota goes through the seam
    store = createSupabasePlatformStore(admin);
    quota = createQuotaMeter({ store, appKey: "recipes" });
  });

  afterAll(async () => {
    if (!instance || !household) return;
    await admin.from("import_jobs").delete().eq("family_id", household.familyId);
    await deleteTestHousehold(admin, household);
  });

  it("claims and completes a job end to end, spending real quota", async () => {
    const urls = await queueJobs(1, "single");
    const outcome = await runNextJob({
      queue: createSupabaseJobQueue(admin),
      quota,
      worker: "w-single",
      imports: { fetcher: fetcherFor(urls) },
    });

    expect(outcome.status).toBe("review");
    const rows = await jobRows();
    expect(rows[0]).toMatchObject({ status: "review", attempts: 1, worker: "w-single" });
    expect(rows[0]?.quota_consumed_at).not.toBeNull();
    // the typed result is what the UI reads
    expect((rows[0]?.result_json as { ok: boolean }).ok).toBe(true);

    expect(await quotaUsed()).toBe(1);

    await admin.from("import_jobs").delete().eq("family_id", household.familyId);
  });

  it("gives each job to exactly one worker under concurrency", async () => {
    // twenty workers racing for twelve jobs. Read-then-write would hand the same job
    // to several of them and the numbers would still look plausible afterwards.
    const urls = await queueJobs(12, "race");
    const fetcher = fetcherFor(urls);
    const workers = Array.from({ length: 20 }, (_, i) =>
      drainQueue({
        queue: createSupabaseJobQueue(admin),
        quota,
        worker: `w-${i}`,
        imports: { fetcher },
        maxJobs: 12,
      }),
    );

    const results = (await Promise.all(workers)).flat();
    const processed = results.filter((r) => r.status !== "idle");
    expect(processed).toHaveLength(12);

    const rows = await jobRows();
    expect(rows).toHaveLength(12);
    // exactly once: a second claim would have incremented attempts
    expect(rows.every((row) => row.attempts === 1)).toBe(true);
    expect(rows.every((row) => row.status === "review")).toBe(true);
    // and no job id appears twice across the workers' outcomes
    const ids = processed.map((outcome) => outcome.job.id);
    expect(new Set(ids).size).toBe(12);

    // twelve jobs, twelve units of quota — one each, no more
    expect(await quotaUsed()).toBe(13); // 1 from the previous test plus 12

    await admin.from("import_jobs").delete().eq("family_id", household.familyId);
  });

  it("does not hand out a job that is already finished", async () => {
    await queueJobs(1, "done");
    await admin
      .from("import_jobs")
      .update({ status: "saved" })
      .eq("family_id", household.familyId);

    const outcome = await runNextJob({
      queue: createSupabaseJobQueue(admin),
      quota,
      worker: "w-none",
      imports: { fetcher: createFakeFetcher({}) },
    });
    expect(outcome).toEqual({ status: "idle" });
    await admin.from("import_jobs").delete().eq("family_id", household.familyId);
  });

  it("reclaims a job whose worker died, and does not charge it twice", async () => {
    const urls = await queueJobs(1, "crashed");
    // a worker claimed it, spent the quota, then vanished
    const usedBefore = await quotaUsed();

    await admin
      .from("import_jobs")
      .update({
        status: "running",
        worker: "w-dead",
        attempts: 1,
        claimed_at: new Date(Date.now() - 3600_000).toISOString(),
        quota_consumed_at: new Date(Date.now() - 3600_000).toISOString(),
      })
      .eq("family_id", household.familyId);

    const outcome = await runNextJob({
      queue: createSupabaseJobQueue(admin),
      quota,
      worker: "w-alive",
      imports: { fetcher: fetcherFor(urls) },
    });

    expect(outcome.status).toBe("review");
    const rows = await jobRows();
    // the lease expired, so it was reclaimed — and the attempt count says so
    expect(rows[0]).toMatchObject({ status: "review", attempts: 2, worker: "w-alive" });

    expect(await quotaUsed()).toBe(usedBefore);

    await admin.from("import_jobs").delete().eq("family_id", household.familyId);
  });

  it("will not let a client claim work", async () => {
    // the function bypasses RLS and decides who is charged
    const { error } = await household.client.rpc("import_claim_next_job", { p_worker: "thief" });
    expect(error).not.toBeNull();
  });

  it("will not let a client mark quota as consumed", async () => {
    const { error } = await household.client.rpc("import_mark_quota_consumed", {
      p_job_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
  });
});

describe.skipIf(instance !== null)("import job queue (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
