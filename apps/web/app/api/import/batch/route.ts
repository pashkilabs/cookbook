import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { planBatch } from "@/lib/batch-input";
import { refusal } from "@/lib/refusal";
import { statusFor } from "@/lib/recipe-writes";

/**
 * Queue a batch of links.
 *
 * **Every URL is judged before anything is queued** (`planBatch`). A social link is refused here
 * rather than after it has taken a place in the queue and a worker has tried it, and a line pasted
 * twice becomes one job rather than two.
 *
 * The response says what happened to each line, in the order they were pasted, so a person can
 * see which of their twenty went in and which did not.
 */
export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  let body: { urls?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const planned = planBatch(body.urls);
  if (!planned.ok) return Response.json({ error: planned.error }, { status: 400 });

  const queueable = planned.entries.filter(
    (entry): entry is Extract<typeof entry, { status: "queue" }> => entry.status === "queue",
  );

  if (queueable.length > 0) {
    /*
     * One insert for the whole batch, with every column spelled out on every row: a PostgREST
     * bulk insert sends the union of the keys across the batch and passes NULL for whatever a row
     * omits, so a defaulted column left off one row arrives as NULL rather than its default.
     *
     * Written with the caller's own session — RLS decides whether it lands, and
     * `household_can_write` refuses a lapsed household at the point of queueing rather than
     * twenty jobs later.
     */
    const { error } = await supabase.from("import_jobs").insert(
      queueable.map((entry) => ({
        family_id: family.id,
        kind: "url" as const,
        input_ref: entry.fetchUrl,
      })),
    );

    if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  }

  return Response.json({
    results: planned.entries.map((entry) => ({
      url: entry.line,
      status: entry.status === "queue" ? "queued" : entry.status,
      ...(entry.status === "rejected" ? { reason: entry.reason, message: entry.message } : {}),
      ...(entry.status === "duplicate" ? { message: entry.message } : {}),
    })),
    queued: queueable.length,
    rejected: planned.entries.filter((entry) => entry.status === "rejected").length,
    duplicates: planned.entries.filter((entry) => entry.status === "duplicate").length,
  });
}
