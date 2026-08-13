import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareRecipe, type PreparedRecipe } from "./recipe-input";
import { refusal } from "./refusal";

/**
 * The child rows of a recipe, written for both create and edit.
 *
 * Not in a route file: a Next route module should export handlers and nothing else, and both
 * routes need this identically.
 */
export async function writeChildren(
  supabase: SupabaseClient,
  familyId: string,
  recipeId: string,
  recipe: PreparedRecipe,
): Promise<string | null> {
  if (recipe.ingredients.length > 0) {
    // every column on every row: PostgREST sends the union of keys across a batch and passes
    // NULL for whatever a row omits, so a column default never applies (CLAUDE.md)
    const { error } = await supabase.from("recipe_ingredients").insert(
      recipe.ingredients.map((line) => ({
        family_id: familyId,
        recipe_id: recipeId,
        position: line.position,
        amount: line.amount,
        unit: line.unit,
        item_text: line.itemText,
        note: line.note,
        is_estimated: line.isEstimated,
        ingredient_id: null,
      })),
    );
    if (error) return refusal(error);
  }

  if (recipe.steps.length > 0) {
    const { error } = await supabase.from("recipe_steps").insert(
      recipe.steps.map((step) => ({
        family_id: familyId,
        recipe_id: recipeId,
        position: step.position,
        text: step.text,
      })),
    );
    if (error) return refusal(error);
  }

  return null;
}

/** A read-only household is not a bad request; it is a household that may not write. */
export function statusFor(error: { code?: string }): number {
  return error.code === "42501" ? 403 : 400;
}

/**
 * Create a recipe, its ingredients, its steps and its photo row.
 *
 * Extracted from `POST /api/recipes` so that accepting a queued import lands through the **same**
 * code rather than a parallel one. A batch that wrote recipes its own way would be a second save
 * path to keep in step with the first, and the review screen's whole job is that what a person saw
 * is what gets stored.
 *
 * Written with the caller's own session: RLS decides whether it lands, and `household_can_write`
 * refuses a lapsed household. This function has no power its caller does not.
 */
export async function createRecipeFrom(
  supabase: SupabaseClient,
  familyId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const prepared = prepareRecipe(body);
  if (!prepared.ok) return { ok: false, error: prepared.error, status: 400 };
  const { recipe } = prepared;

  const sourceUrl =
    typeof body.sourceUrl === "string" && body.sourceUrl.startsWith("http")
      ? body.sourceUrl.slice(0, 2000)
      : null;
  const photo = readPhoto(body.photo, familyId);

  const created = await supabase
    .from("recipes")
    .insert({
      family_id: familyId,
      title: recipe.title,
      servings: recipe.servings,
      time_minutes: recipe.timeMinutes,
      source_name: recipe.sourceName,
      source_url: sourceUrl,
      times_made: 0,
      status: "active",
      visibility: "private",
      make_again: null,
      created_by: null,
    })
    .select("id")
    .single();

  if (created.error) {
    return { ok: false, error: refusal(created.error), status: statusFor(created.error) };
  }

  const written = await writeChildren(supabase, familyId, created.data.id, recipe);
  if (written) {
    // The recipe exists and its ingredients do not. Tombstoned rather than left as a title with
    // nothing in it — a client cannot hard-delete (grants revoked in 091300), and a tombstone is
    // what a syncing device can see anyway.
    await supabase
      .from("recipes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", created.data.id);
    return { ok: false, error: written, status: 400 };
  }

  if (photo) {
    /*
     * The moment the object becomes reachable.
     *
     * Storage read policies resolve through this row (090700), so bytes uploaded during the
     * preview — or by the queue runner — were readable by nobody until now. `source` is `import`,
     * the original site's photograph rather than the household's, which is what keeps it off a
     * published page while the copyright question is open (decisions §17).
     */
    const { error } = await supabase.from("photos").insert({
      family_id: familyId,
      recipe_id: created.data.id,
      storage_path: photo.storagePath,
      source: "import",
      upload_state: "stored",
      width: photo.width,
      height: photo.height,
    });
    if (error) {
      // the recipe is the point; a photo that will not attach is worth reporting, not unwinding
      console.warn(`[pashki] saved recipe ${created.data.id} without its photo: ${error.message}`);
    }
  }

  return { ok: true, id: created.data.id };
}

/**
 * The photo the preview or the runner uploaded, if any.
 *
 * The path is checked against this household's folder before it is trusted: it arrives from the
 * client, and `photos_path_in_household` would refuse a foreign one anyway — but a clear refusal
 * beats a constraint violation, and the check costs one comparison.
 */
function readPhoto(value: unknown, familyId: string) {
  if (typeof value !== "object" || value === null) return null;
  const photo = value as { storagePath?: unknown; width?: unknown; height?: unknown };
  if (typeof photo.storagePath !== "string" || !photo.storagePath.startsWith(`${familyId}/`)) {
    return null;
  }
  return {
    storagePath: photo.storagePath,
    width: Number.isInteger(photo.width) ? (photo.width as number) : null,
    height: Number.isInteger(photo.height) ? (photo.height as number) : null,
  };
}
