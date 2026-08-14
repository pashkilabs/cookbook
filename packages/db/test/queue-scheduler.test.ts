import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * The scheduler's tick.
 *
 * The claim's atomicity is proven elsewhere — twenty workers racing twelve jobs, in
 * `@pashki/import`. What is proven here is the thing the scheduler adds: **when it decides to
 * call out at all**, and that its predicate agrees with the claim's.
 *
 * The two must agree or the queue either spins on work it cannot take, or sleeps on work it
 * could. Sleeping is the quiet failure: a job that never drains looks exactly like a queue with
 * nothing in it, which is why `dispatch_import_drain` reports a reason rather than returning void.
 */
const instance = readLocalInstance();
const LEASE_SECONDS = 300;

describe.skipIf(instance === null)("the import queue scheduler", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  /**
   * `private` is not a schema PostgREST exposes, and it must not become one — a generic
   * SQL-over-HTTP endpoint would be a far worse hole than anything this file tests. So the
   * probes go through psql in the container, the same way `scripts/mutate-rls.sh` does.
   */
  const sql = <T>(query: string): T => {
    const out = execFileSync(
      "docker",
      ["exec", "-i", "supabase_db_db", "psql", "-U", "postgres", "-d", "postgres", "-tAc", query],
      { encoding: "utf8", timeout: 30_000 },
    ).trim();
    return (out === "" ? null : JSON.parse(out)) as T;
  };

  /** For statements rather than questions: no output to parse. */
  const exec = (query: string): void => {
    execFileSync(
      "docker",
      ["exec", "-i", "supabase_db_db", "psql", "-U", "postgres", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-c", query],
      { encoding: "utf8", timeout: 30_000 },
    );
  };

  const hasWork = (): boolean =>
    sql<boolean>("select to_jsonb(private.import_queue_has_work())");

  const queueJob = async (overrides: Record<string, unknown> = {}) => {
    const { data, error } = await admin
      .from("import_jobs")
      .insert({
        family_id: household.familyId,
        kind: "url",
        input_ref: `https://example.com/${Math.random().toString(36).slice(2)}`,
        ...overrides,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  };

  const clearQueue = () => admin.from("import_jobs").delete().eq("family_id", household.familyId);

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "scheduler",
    });
    await clearQueue();
  });

  afterAll(async () => {
    if (!instance || !household) return;
    await clearQueue();
    await deleteTestHousehold(admin, household);
  });

  describe("when it wakes up", () => {
    it("stays asleep on an empty queue", async () => {
      await clearQueue();
      expect(hasWork()).toBe(false);
    });

    it("wakes for a queued job", async () => {
      await clearQueue();
      await queueJob();
      expect(hasWork()).toBe(true);
    });

    it("stays asleep while a worker still holds its lease", async () => {
      // the case that would make it spin: a job is running and someone is already on it
      await clearQueue();
      await queueJob({
        status: "running",
        worker: "w-alive",
        claimed_at: new Date(Date.now() - 10_000).toISOString(),
        attempts: 1,
      });
      expect(hasWork()).toBe(false);
    });

    it("wakes for a job whose lease expired", async () => {
      /*
       * The reclaim is exercised by the normal path rather than by an operator noticing. A
       * worker that died mid-job leaves the row `running` forever otherwise, and nothing would
       * ever call out to pick it up again.
       */
      await clearQueue();
      await queueJob({
        status: "running",
        worker: "w-dead",
        claimed_at: new Date(Date.now() - (LEASE_SECONDS + 60) * 1000).toISOString(),
        attempts: 1,
      });
      expect(hasWork()).toBe(true);
    });

    it("stays asleep for jobs that are finished or cancelled", async () => {
      await clearQueue();
      for (const status of ["review", "saved", "failed", "cancelled"]) {
        await queueJob({ status });
      }
      expect(hasWork()).toBe(false);
    });

    it("stays asleep for a tombstoned job", async () => {
      await clearQueue();
      await queueJob({ deleted_at: new Date().toISOString() });
      expect(hasWork()).toBe(false);
    });
  });

  describe("agreeing with the claim", () => {
    /**
     * The property that matters more than any single case above: for every queue state, the
     * scheduler wakes exactly when `import_claim_next_job` would return a row.
     *
     * Asserted by *doing* both rather than by reading the two predicates, because they are
     * separate pieces of SQL that can drift apart silently.
     */
    const states: Array<[string, Record<string, unknown>]> = [
      ["queued", {}],
      ["running, lease alive", {
        status: "running", worker: "w", attempts: 1,
        claimed_at: new Date(Date.now() - 5_000).toISOString(),
      }],
      ["running, lease expired", {
        status: "running", worker: "w", attempts: 1,
        claimed_at: new Date(Date.now() - (LEASE_SECONDS + 60) * 1000).toISOString(),
      }],
      ["review", { status: "review" }],
      ["failed", { status: "failed" }],
      ["cancelled", { status: "cancelled" }],
      ["tombstoned", { deleted_at: new Date().toISOString() }],
    ];

    for (const [label, overrides] of states) {
      it(`agrees for a job that is ${label}`, async () => {
        await clearQueue();
        await queueJob(overrides);

        const woke = hasWork();
        const { data: claimed, error } = await admin.rpc("import_claim_next_job", {
          p_worker: "agreement-probe",
        });
        if (error) throw error;
        const gotRow = (Array.isArray(claimed) ? claimed.length : claimed ? 1 : 0) > 0;

        expect(woke, `has_work said ${woke}, the claim ${gotRow ? "took" : "took no"} row`).toBe(gotRow);
      });
    }
  });

  describe("the tick itself", () => {
    it("does not call out when the queue is empty", async () => {
      await clearQueue();
      const result = sql<{ dispatched: boolean; reason: string }>(
        "select private.dispatch_import_drain()",
      );
      expect(result).toMatchObject({ dispatched: false, reason: "idle" });
    });

    it("says so when there is work and nowhere to send it", async () => {
      // an unconfigured scheduler and an empty queue must not look the same, or a queue that
      // never drains reads as a queue with nothing in it
      await clearQueue();
      await queueJob();
      const result = sql<{ dispatched: boolean; reason: string }>(
        "select private.dispatch_import_drain()",
      );
      expect(result).toMatchObject({ dispatched: false, reason: "not-configured" });
    });

    it("calls out once it has somewhere to send work", async () => {
      // pg_net is asynchronous: http_post returns a request id immediately and the response
      // lands later. The id is what proves the call was made, and it is deterministic —
      // asserting on the response would be asserting on a background worker's timing.
      await clearQueue();
      await queueJob();
      exec(
        `insert into private.scheduler_config (id, drain_endpoint, secret)
         values (true, 'http://127.0.0.1:9/api/import/drain', 'test-secret')
         on conflict (id) do update set drain_endpoint = excluded.drain_endpoint`,
      );
      try {
        const result = sql<{ dispatched: boolean; request_id: number }>(
          "select private.dispatch_import_drain()",
        );
        expect(result.dispatched).toBe(true);
        expect(typeof result.request_id).toBe("number");
      } finally {
        exec("delete from private.scheduler_config");
      }
    });
  });

  it("is scheduled exactly once", async () => {
    const rows = sql<Array<{ jobname: string; schedule: string }>>(
      "select jsonb_agg(jsonb_build_object('jobname', jobname, 'schedule', schedule)) from cron.job where jobname = 'pashki-import-drain'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ schedule: "* * * * *" });
  });
});

describe.skipIf(instance !== null)("the import queue scheduler (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
