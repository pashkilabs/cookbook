import { timingSafeEqual } from "node:crypto";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { drainImportQueue } from "@/lib/queue";

/**
 * Turn the handle.
 *
 * Two callers, both authenticated, for different reasons.
 *
 * The **batch screen** calls it while somebody watches, so results appear as they land. The
 * **scheduler** calls it on a timer with a shared secret, which is what makes a closed tab stop
 * meaning a stranded queue (decisions §35). Neither is an open endpoint: draining costs fetches
 * and spends other people's quota, so an unauthenticated caller could burn a household's
 * allowance from outside.
 *
 * **The queue is global and the claim is atomic**, so this drains whatever is oldest, including
 * another household's jobs. That is the design — `import_claim_next_job` orders by `created_at`
 * across everybody — and it is why a household cannot starve another by pasting fifty links: each
 * claim takes one row.
 */
export async function POST(request: Request) {
  if (!(await authorised(request))) {
    return Response.json({ error: "sign in first" }, { status: 401 });
  }

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

/**
 * A signed-in household, or the scheduler.
 *
 * The secret is compared with `timingSafeEqual` on equal-length buffers. A `===` here leaks the
 * length and the matching prefix through timing, and this is the one door a machine knocks on
 * repeatedly — the ideal conditions for that to matter.
 */
async function authorised(request: Request): Promise<boolean> {
  const presented = request.headers.get("x-pashki-drain-secret");
  const expected = process.env.PASHKI_DRAIN_SECRET;

  if (presented && expected) {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    // length must match before timingSafeEqual, which throws otherwise; compared first so a
    // wrong-length guess is refused without revealing anything else
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }

  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;

  // a signed-in account with no household has nothing to drain for
  return (await platformStore().findFamilyForAccount(auth.user.id)) !== null;
}
