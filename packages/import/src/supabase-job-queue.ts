import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClaimableKind,
  FinishJobInput,
  FinishOutcome,
  ImportJob,
  JobQueue,
} from "./job-runner.js";

export interface SupabaseJobQueueOptions {
  /** which app's entitlement pays for these imports */
  appKey?: string;
  /** which counter on that entitlement */
  quota?: string;
}

/**
 * `import_jobs` as the queue.
 *
 * Requires the **service role**: `import_claim_next_job` bypasses RLS and decides who
 * gets charged, so a client that could call it could take another household's work.
 *
 * Both operations are database functions rather than select-then-update here, and for the same
 * reason in each case — the thing that makes them correct cannot be expressed across two round
 * trips. `FOR UPDATE SKIP LOCKED` is what makes two workers safe; recording an outcome and
 * spending the household's import in one transaction is what makes the meter honest without a
 * refund path.
 *
 * The app key and counter name are configuration the caller supplies, the same two strings it
 * already gives `createQuotaMeter`. Nothing here learns the shape of a platform table: the
 * spending is `platform_spend_quota`, called by the database, which is the seam's own function.
 */
export function createSupabaseJobQueue(
  supabase: SupabaseClient,
  options: SupabaseJobQueueOptions = {},
): JobQueue {
  const appKey = options.appKey ?? "recipes";
  const quota = options.quota ?? "imports";

  return {
    async claim(worker: string): Promise<ImportJob | null> {
      const { data, error } = await supabase.rpc("import_claim_next_job", {
        p_worker: worker,
      });
      if (error) throw error;

      // the function returns a set, so an empty queue is an empty array
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;

      return {
        id: row.id,
        familyId: row.family_id,
        kind: row.kind as ClaimableKind,
        inputRef: row.input_ref,
        attempts: row.attempts,
        quotaConsumedAt: row.quota_consumed_at,
      };
    },

    async finish(input: FinishJobInput): Promise<FinishOutcome> {
      const { data, error } = await supabase.rpc("import_finish_job", {
        p_job_id: input.jobId,
        p_status: input.status,
        // the typed failure lives here, so a UI can branch on `failure.kind`
        p_result: input.result as unknown as Record<string, unknown>,
        p_error: input.errorSummary,
        p_app_key: appKey,
        p_quota: quota,
        p_charge: input.charge,
      });
      if (error) throw error;

      const outcome = (data ?? {}) as {
        recorded?: string;
        charged?: boolean;
        quota?: string | null;
      };
      return {
        recorded: outcome.recorded === "failed" ? "failed" : "review",
        charged: outcome.charged === true,
        quota: (outcome.quota as FinishOutcome["quota"]) ?? null,
      };
    },
  };
}
