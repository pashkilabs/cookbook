import { createClient } from "@supabase/supabase-js";
import type { JobResult } from "@pashki/import";
import { draftFrom } from "@/lib/import";

/**
 * Reading the queue's progress, and describing a failure in words.
 *
 * `import_jobs` rows are readable by the household through RLS, but `status`, `result_json` and
 * `error` are the runner's columns — a client has no UPDATE grant on any of them (091100). So a
 * person can watch their batch and cancel it, and cannot tell the queue that a job succeeded.
 */
export type JobStatus = "queued" | "running" | "review" | "saved" | "failed" | "cancelled";

export interface JobRow {
  id: string;
  input_ref: string;
  status: JobStatus;
  error: string | null;
  result_json: unknown;
  created_at: string;
}

/** The service role, for the two columns a client is deliberately not allowed to write. */
export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * What a person is shown for one job.
 *
 * A job in `review` carries its draft, so the batch screen can render every finished import
 * without a request each. A failed one carries a sentence rather than a `kind`, because "that
 * page publishes no machine-readable recipe" is actionable and `no-recipe-found` is not.
 */
export function describeJob(row: JobRow) {
  const result = row.result_json as JobResult | null;

  const base = {
    id: row.id,
    url: row.input_ref,
    status: row.status,
    queuedAt: row.created_at,
  };

  if (row.status === "review" && result && result.ok) {
    return {
      ...base,
      draft: draftFrom(result.recipe),
      photo: result.photo,
      tier: result.tier,
      fromCache: result.fromCache,
    };
  }

  if (row.status === "failed") {
    const failure = result && !result.ok ? result.failure : null;
    return { ...base, message: explainFailure(failure, row.error) };
  }

  return base;
}

/** Say what happened, and never claim a capability that is not built. */
export function explainFailure(
  failure: { kind: string; [key: string]: unknown } | null,
  fallback: string | null,
): string {
  switch (failure?.kind) {
    case "blocked-platform":
      return `${String(failure.platform ?? "That site")} links never resolve to a page containing the recipe.`;
    case "no-recipe-found":
      return (
        "This page publishes no machine-readable recipe. Structured data and microdata both " +
        "found nothing, and reading the page text itself is not built yet."
      );
    case "recipe-incomplete":
      return `The page had recipe data but not enough of it — missing ${
        Array.isArray(failure.missing) ? failure.missing.join(", ") : "required fields"
      }.`;
    case "fetch-failed":
    case "not-html":
      return `That page could not be read (${String(failure.detail ?? failure.kind)}). Some sites refuse automated requests.`;
    case "private-address":
    case "invalid-url":
      return "That does not look like a recipe link.";
    case "quota-exceeded":
      return failure.reason === "no-entitlement"
        ? "This household has no import allowance. A subscription is what grants one."
        : "You have used this month's imports. The allowance resets with the billing period.";
    case "unsupported-job-kind":
      return `${String(failure.jobKind)} imports are not built yet.`;
    default:
      return fallback ?? "That import did not work.";
  }
}
