import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimableKind, FinishJobInput, ImportJob, JobQueue } from "./job-runner.js";

/**
 * `import_jobs` as the queue.
 *
 * Requires the **service role**: `import_claim_next_job` bypasses RLS and decides who
 * gets charged, so a client that could call it could take another household's work.
 *
 * The claim is a database function rather than a select-then-update here, because
 * `FOR UPDATE SKIP LOCKED` is the only part that makes two workers safe and it cannot
 * be expressed across two round trips.
 */
export function createSupabaseJobQueue(supabase: SupabaseClient): JobQueue {
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

    async finish(input: FinishJobInput): Promise<void> {
      const { error } = await supabase
        .from("import_jobs")
        .update({
          status: input.status,
          // the typed failure lives here, so a UI can branch on `failure.kind`
          result_json: input.result as unknown as Record<string, unknown>,
          error: input.errorSummary,
          finished_at: new Date().toISOString(),
        })
        .eq("id", input.jobId);
      if (error) throw error;
    },

    async markQuotaConsumed(jobId: string): Promise<void> {
      // idempotent in SQL: coalesce keeps the first timestamp
      const { error } = await supabase.rpc("import_mark_quota_consumed", {
        p_job_id: jobId,
      });
      if (error) throw error;
    },
  };
}
