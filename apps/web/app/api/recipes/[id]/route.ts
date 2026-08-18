import { userClient } from "@/lib/supabase-server";
import { maybeRow, rows } from "@/lib/rows";
import { platformStore } from "@/lib/platform";
import { prepareRecipe } from "@/lib/recipe-input";
import { statusFor, writeChildren , classifyIfUnclassified } from "@/lib/recipe-writes";
import { refusal } from "@/lib/refusal";

/**
 * Edit or remove one recipe.
 *
 * Both filter by `family_id` as well as by id. RLS would already refuse another household's
 * row, but a published recipe is *readable* across households (decisions §17) and an update
 * that matches nothing returns success with zero rows — so without the filter, editing a
 * stranger's recipe would look like it worked. The row count is checked, not assumed.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const prepared = prepareRecipe(body as Record<string, unknown>);
  if (!prepared.ok) return Response.json({ error: prepared.error }, { status: 400 });
  const { recipe } = prepared;

  const updated = await supabase
    .from("recipes")
    .update({
      title: recipe.title,
      servings: recipe.servings,
      time_minutes: recipe.timeMinutes,
      // correctable here because the review screen only exists at import, and no already-saved
      // recipe will pass through it again — a wrong course would otherwise be permanent on the
      // field the browse picker rests on
      course: recipe.course,
      cuisine: recipe.cuisine,
      dish_form: recipe.dishForm,
      principal_protein: recipe.principalProtein,
      source_name: recipe.sourceName,
    })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id");

  if (updated.error) {
    return Response.json({ error: refusal(updated.error) }, { status: statusFor(updated.error) });
  }
  if (updated.data.length === 0) {
    // no rows: either it is not ours or it is already gone. Same answer for both, which is the
    // same reasoning as the detail screen's 404.
    return Response.json({ error: "no such recipe" }, { status: 404 });
  }

  /**
   * Children are replaced wholesale: tombstone the old rows, insert the new ones.
   *
   * Not a diff. Position is the only identity an ingredient line has, so "line 3 changed" and
   * "a line was inserted above it" are indistinguishable from the text alone — a diff would
   * guess. Tombstoning also happens to be what a syncing device needs: a peer sees rows that
   * went, rather than rows that silently stopped existing (architecture §5).
   */
  const removedAt = new Date().toISOString();
  for (const table of ["recipe_ingredients", "recipe_steps"] as const) {
    const { error } = await supabase
      .from(table)
      .update({ deleted_at: removedAt })
      .eq("recipe_id", id)
      .eq("family_id", familyId)
      .is("deleted_at", null);
    if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  }

  const failure = await writeChildren(supabase, familyId, id, recipe);
  if (failure) return Response.json({ error: failure }, { status: 400 });

  return Response.json({ id });
}

/**
 * Re-classify, only when asked.
 *
 * **Never automatic on edit.** Somebody may have corrected a field by hand, and a model
 * overwriting that is worse than the field being stale — a person who fixes "beef" on a mushroom
 * pasta and watches it come back beef will stop fixing anything. So this is a button, and it
 * clears `classified_at` first so the same guarded path the backfill uses does the work.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  // filtered here as well as by RLS: a policy says what may leave the database, a screen says
  // whose kitchen it shows, and those are different questions
  const owned = await supabase
    .from("recipes")
    .select("id")
    .eq("id", id)
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!owned.data) return Response.json({ error: "no such recipe" }, { status: 404 });

  // asked for explicitly, so the existing values are cleared rather than protected — that is
  // what the button means
  await supabase
    .from("recipes")
    // classified_at too, or the guarded path returns early and the button does nothing
    .update({ course: null, cuisine: null, dish_form: null, principal_protein: null, classified_at: null })
    .eq("id", id);
  await classifyIfUnclassified(supabase, id);

  const after = maybeRow(
    await supabase
    .from("recipes")
    .select("course, cuisine, dish_form, principal_protein")
    .eq("id", id)
    .maybeSingle(),
    "after",
  );
  return Response.json({ ok: true, classification: after ?? null });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  // A tombstone, not a delete. Clients hold no DELETE privilege (091300) because a hard-deleted
  // row is the one thing a peer cannot tell from a row that never synced.
  //
  // **The children are tombstoned by a database trigger, not here** (decisions §30). That is
  // deliberate and it is invisible from this file, so: `private.propagate_soft_delete` fires on
  // this UPDATE and carries the same timestamp down to plan_entries, shortlist_entries, ratings,
  // photos, recipe_ingredients and recipe_steps. It lives in the database because Phase 3's sync
  // will write `deleted_at` straight into Postgres from a device, without passing through here.
  const { data, error } = await supabase
    .from("recipes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id");

  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  if (data.length === 0) return Response.json({ error: "no such recipe" }, { status: 404 });
  return Response.json({ id });
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
