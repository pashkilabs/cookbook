import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { drainImportQueue } from "@/lib/queue";

/**
 * Turn the handle.
 *
 * Triggered by the batch screen while somebody is watching, which is not what production wants —
 * see `lib/queue.ts` for what a deployed worker changes. It is authenticated so that draining is
 * something a household does rather than an open endpoint, even though the runner works on the
 * whole queue rather than on one household's jobs.
 *
 * **The queue is global and the claim is atomic**, so this drains whatever is oldest, including
 * another household's jobs. That is the design — `import_claim_next_job` orders by `created_at`
 * across everybody — and it is why a household cannot starve another by pasting fifty links: each
 * claim takes one row.
 */
export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  let maxJobs = 5;
  try {
    const body = (await request.json()) as { maxJobs?: unknown };
    if (Number.isInteger(body.maxJobs) && (body.maxJobs as number) > 0) {
      maxJobs = Math.min(body.maxJobs as number, 10);
    }
  } catch {
    // no body is fine; the default is a handful
  }

  // one slice per call, so a request finishes well inside any platform timeout and the screen
  // can show progress rather than freezing until the last job lands
  const outcomes = await drainImportQueue(maxJobs);
  return Response.json({
    processed: outcomes.length,
    idle: outcomes.length === 0,
    outcomes: outcomes.map((outcome) => ({
      status: outcome.status,
      ...(outcome.status !== "idle" ? { jobId: outcome.job.id } : {}),
    })),
  });
}
