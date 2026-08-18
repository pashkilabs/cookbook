import { userClient } from "@/lib/supabase-server";
import { maybeRow, rows } from "@/lib/rows";
import { platformStore } from "@/lib/platform";
import { admin } from "@/lib/import-jobs";
import { createRecipeFrom } from "@/lib/recipe-writes";
import { RECIPE_PHOTO_BUCKET } from "@pashki/import/photo-bucket";

/**
 * Accept a reviewed import, or discard it.
 *
 * **Accepting some and discarding others must not disturb the rest**, so each is one job and one
 * request. Nothing here operates on the batch: a failure to save the third recipe leaves the other
 * nineteen exactly where they were, in review, still acceptable.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  // Ownership is established by reading through the caller's own session — RLS answers the
  // question — before anything touches the service role below.
  const job = maybeRow(
    await supabase
    .from("import_jobs")
    .select("id, status, result_json")
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle(),
    "job",
  );

  if (!job) return Response.json({ error: "no such import" }, { status: 404 });
  if (job.status !== "review") {
    return Response.json({ error: `that import is ${job.status}, not waiting for review` }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const created = await createRecipeFrom(supabase, familyId, body);
  if (!created.ok) return Response.json({ error: created.error }, { status: created.status });

  /*
   * `saved` is the runner's column, not the client's: a client with an UPDATE grant on `status`
   * could mark somebody else's queued job saved and strand it. So the stamp goes through the
   * service role — which bypasses RLS, and is therefore filtered by `family_id` here by hand.
   *
   * The recipe is already saved at this point. If this stamp fails the job stays in review and
   * could be accepted twice; the alternative is a transaction spanning two roles, which PostgREST
   * cannot express. Reported rather than hidden.
   */
  const stamped = await admin()
    .from("import_jobs")
    .update({ status: "saved" })
    .eq("id", id)
    .eq("family_id", familyId);

  if (stamped.error) {
    console.warn(`[pashki] saved recipe ${created.id} but job ${id} is still in review`);
  }

  return Response.json({ id: created.id });
}

/**
 * Discard one result.
 *
 * `cancelled`, not a tombstone: what happened to a job is worth keeping, and a batch of twenty
 * where six were thrown away is a fact about the import — not something to erase. The photo the
 * runner uploaded goes with it, because no `photos` row will ever point at it and an object with
 * no row is reachable by nobody, forever.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  const job = maybeRow(
    await supabase
    .from("import_jobs")
    .select("id, status, result_json")
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle(),
    "job",
  );

  if (!job) return Response.json({ error: "no such import" }, { status: 404 });

  const service = admin();
  const result = job.result_json as { ok?: boolean; photo?: { storagePath?: string } } | null;
  const storagePath = result?.ok ? result.photo?.storagePath : undefined;
  if (storagePath?.startsWith(`${familyId}/`)) {
    // through the Storage API: a `storage.protect_delete()` trigger refuses SQL deletes on
    // storage.objects, so this is the only door
    await service.storage.from(RECIPE_PHOTO_BUCKET).remove([storagePath]);
  }

  const { error } = await service
    .from("import_jobs")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("family_id", familyId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ discarded: id });
}

async function household() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { response: Response.json({ error: "sign in first" }, { status: 401 }) };
  }
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) {
    return { response: Response.json({ error: "this account has no household" }, { status: 403 }) };
  }
  return { supabase, familyId: family.id };
}
