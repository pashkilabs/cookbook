import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * A client submits import jobs; the worker runs the queue.
 *
 * RLS decides which *rows* a caller may write and says nothing about which *columns*.
 * `authenticated` held table-wide INSERT and UPDATE here, so every column the worker
 * uses to run the queue could be asserted by the client submitting the work — including
 * the one the runner consults before charging quota.
 */
const instance = readLocalInstance();
const NO_PRIVILEGE = "42501";

describe.skipIf(instance === null)("who may write an import job", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  const submit = (over: Record<string, unknown> = {}) =>
    household.client
      .from("import_jobs")
      .insert({
        family_id: household.familyId,
        kind: "url",
        input_ref: "https://example.com/recipe",
        ...over,
      })
      .select("id");

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "job-writes",
    });
  });

  afterAll(async () => {
    if (!instance) return;
    if (household) await deleteTestHousehold(admin, household);
  });

  it("queues a job with the three things a client actually knows", async () => {
    const { error } = await submit();
    expect(error).toBeNull();
  });

  it("mints its own id, so a job can be queued with no signal", async () => {
    const { error } = await submit({ id: "11111111-1111-1111-1111-111111111111" });
    expect(error).toBeNull();
  });

  it("refuses a job that arrives already paid for", async () => {
    // regression: the runner charges only when quota_consumed_at is null, so a client
    // setting it got the fetch and the model call for free — with quota being the whole
    // cost lever (decisions §8)
    const { error } = await submit({ quota_consumed_at: new Date().toISOString() });
    expect(error?.code).toBe(NO_PRIVILEGE);
  });

  it("refuses a job that back-dates itself to the front of the queue", async () => {
    // regression: import_claim_next_job orders by created_at, so this is served before
    // every other household, forever
    const { error } = await submit({ created_at: "1970-01-01T00:00:00Z" });
    expect(error?.code).toBe(NO_PRIVILEGE);
  });

  it("refuses a job that declares its own state", async () => {
    const { error } = await submit({ status: "review" });
    expect(error?.code).toBe(NO_PRIVILEGE);
  });

  it("refuses a job that arrives with a result", async () => {
    const { error } = await submit({ result_json: { ok: true } });
    expect(error?.code).toBe(NO_PRIVILEGE);
  });

  describe("once a job exists", () => {
    let jobId: string;

    beforeAll(async () => {
      if (!instance) return;
      const job = await admin
        .from("import_jobs")
        .insert({
          family_id: household.familyId,
          kind: "url",
          input_ref: "https://example.com/running",
          status: "failed",
          attempts: 3,
          quota_consumed_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (job.error) throw job.error;
      jobId = job.data.id;
    });

    it("cannot be rewound and run again for nothing", async () => {
      // regression: status back to queued with attempts cleared re-runs work already
      // paid for once — or, with quota_consumed_at set, never paid for at all
      const { error } = await household.client
        .from("import_jobs")
        .update({ status: "queued", attempts: 0, claimed_at: null, worker: null })
        .eq("id", jobId);
      expect(error?.code).toBe(NO_PRIVILEGE);
    });

    it("cannot have its charge erased", async () => {
      const { error } = await household.client
        .from("import_jobs")
        .update({ quota_consumed_at: null })
        .eq("id", jobId);
      expect(error?.code).toBe(NO_PRIVILEGE);
    });

    it("can be cancelled, because a tombstone stops it being claimable", async () => {
      // import_claim_next_job skips deleted_at is not null, so cancelling needs no
      // access to the state machine
      const { error } = await household.client
        .from("import_jobs")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", jobId);
      expect(error).toBeNull();
    });

    it("stays visible to the household that submitted it", async () => {
      const { data, error } = await household.client
        .from("import_jobs")
        .select("id, status, attempts, quota_consumed_at")
        .eq("id", jobId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });
});

describe.skipIf(instance !== null)("who may write an import job (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
