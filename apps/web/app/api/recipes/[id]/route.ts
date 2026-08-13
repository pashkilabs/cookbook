import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { prepareRecipe } from "@/lib/recipe-input";
import { statusFor, writeChildren } from "@/lib/recipe-writes";
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

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  // A tombstone, not a delete. Clients hold no DELETE privilege (091300) because a hard-deleted
  // row is the one thing a peer cannot tell from a row that never synced. The recipe's children
  // keep their rows — the recipe is the tombstone, and its absence hides them everywhere.
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
