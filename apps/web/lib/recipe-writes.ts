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
      course: recipe.course,
      cuisine: recipe.cuisine,
      dish_form: recipe.dishForm,
      principal_protein: recipe.principalProtein,
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

/**
 * Attach a photograph the household took, to a recipe that already exists.
 *
 * `source` is `camera`, not `import` — the household's own picture rather than the original
 * site's, which is the distinction 090700's storage policies and §17's publishing rule both
 * turn on. An imported image stays off a published page while the copyright question is open;
 * one a household took itself does not have that problem.
 *
 * **Not the card.** A photograph *of a recipe card* is provenance rather than a picture of the
 * food, and publishing one would put a copyrighted printed page on a world-readable URL. That is
 * `source = 'source'` and it is deliberately not built here — so the import Photograph path still
 * discards its card image, which is a known gap rather than an oversight.
 *
 * One photo per recipe: attaching a second replaces the first, because "the photo of this recipe"
 * is what every screen asks for and a list is a different feature.
 */
export async function attachRecipePhoto(
  supabase: SupabaseClient,
  familyId: string,
  recipeId: string,
  bytes: Uint8Array,
): Promise<{ ok: true; storagePath: string } | { ok: false; error: string; status: number }> {
  const owned = await supabase
    .from("recipes")
    .select("id")
    .eq("id", recipeId)
    .is("deleted_at", null)
    .maybeSingle();
  // filtered here as well as by RLS: a policy decides what may leave the database, a screen
  // decides whose kitchen it shows, and those are different questions (CLAUDE.md)
  if (!owned.data) return { ok: false, error: "no such recipe", status: 404 };

  /*
   * The entitlement gate runs *before* the upload, not after.
   *
   * `photos_insert_in_household` requires `household_can_write`, and so does the storage policy.
   * With the object written first, a lapsed household uploaded bytes and was then refused the
   * row — leaving an orphan for the reaper on every attempt. The upload is the expensive,
   * irreversible half; refusing early costs one cheap query and leaves nothing to collect.
   */
  const writable = await supabase.rpc("household_can_write_recipes");
  if (writable.data === false) {
    return { ok: false, error: "this household has no active subscription", status: 403 };
  }

  const { storeImportedPhoto } = await import("@pashki/import/photo-storage");
  const stored = await storeImportedPhoto({ familyId, bytes }, { supabase });
  if (!stored.ok) {
    return { ok: false, error: `${stored.failure.kind}: ${stored.failure.detail}`, status: 422 };
  }

  /*
   * Tombstone then insert, not an upsert.
   *
   * `photos` is unique on `id` and `storage_path` and **not on `recipe_id`**, so
   * `onConflict: "recipe_id"` is a runtime error rather than a replace — Postgres wants a
   * constraint matching the target and there is none. Tombstoning is also what this schema means
   * by deletion everywhere else: clients hold no DELETE, every removal is an UPDATE setting
   * `deleted_at`, and the reaper collects the orphaned object later.
   */
  const tombstoned = await supabase
    .from("photos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("recipe_id", recipeId)
    .is("deleted_at", null);
  if (tombstoned.error) return { ok: false, error: tombstoned.error.message, status: 500 };

  const { error } = await supabase.from("photos").insert({
    family_id: familyId,
    recipe_id: recipeId,
    storage_path: stored.storagePath,
    source: "camera",
    upload_state: "stored",
    width: stored.width,
    height: stored.height,
  });
  if (error) return { ok: false, error: error.message, status: 500 };

  return { ok: true, storagePath: stored.storagePath };
}

/**
 * Classify a recipe nobody classified — on save, and only when there is nothing to overwrite.
 *
 * **Why on save rather than on demand.** Someone typing a recipe in has just done the work of
 * entering it; asking them to find a second control to make it findable is the same failure four
 * features have already hit here. A recipe added by hand was invisible to browse entirely.
 *
 * **Why it is not wasteful.** It runs only when all four fields are empty, which is the same
 * `classified_at is null` cursor the backfill uses — so a person who set the fields themselves
 * pays nothing, and neither does a re-save.
 *
 * **Why a failure is silent.** The recipe is the point. A model that is down, rate-limited or
 * unconfigured must not stop somebody saving their grandmother's rolls; the row simply stays
 * unstamped and the backfill picks it up later, which is what an unstamped row means.
 */
export async function classifyIfUnclassified(
  supabase: SupabaseClient,
  recipeId: string,
): Promise<void> {
  const { cascadeFromEnv } = await import("@pashki/import");
  const { classifyRecipe } = await import("@pashki/import");
  const cascade = cascadeFromEnv();
  if (!cascade) return;

  const { data: recipe } = await supabase
    .from("recipes")
    .select("id, title, course, cuisine, dish_form, principal_protein, classified_at")
    .eq("id", recipeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!recipe || recipe.classified_at) return;
  // nothing to overwrite is the precondition, not just "unstamped"
  if (recipe.course || recipe.cuisine || recipe.dish_form || recipe.principal_protein) return;

  const [ings, steps] = await Promise.all([
    supabase.from("recipe_ingredients").select("amount, unit, item_text, note").eq("recipe_id", recipeId).is("deleted_at", null).order("position"),
    supabase.from("recipe_steps").select("text").eq("recipe_id", recipeId).is("deleted_at", null).order("position"),
  ]);

  try {
    const cls = await classifyRecipe({
      provider: cascade.provider,
      model: cascade.models[0]!,
      recipe: {
        title: recipe.title as string,
        ingredients: (ings.data ?? []).map((row) =>
          [row.amount ?? "", row.unit ?? "", row.item_text, row.note ? `, ${row.note}` : ""]
            .join(" ")
            .trim()),
        steps: (steps.data ?? []).map((row) => row.text as string),
      },
    });
    if (!cls) return;
    await supabase
      .from("recipes")
      // cuisine included here and not in the backfill: this reads the same stored shape, but a
      // hand-typed recipe has no prose anywhere, so there is no better moment to ask (§54)
      .update({
        course: cls.course,
        dish_form: cls.dishForm,
        principal_protein: cls.principalProtein,
        classified_at: new Date().toISOString(),
      })
      .eq("id", recipeId);
  } catch (thrown) {
    // unstamped is exactly what "not yet classified" means; the backfill will find it
    console.warn(`[pashki] could not classify ${recipeId}: ${String(thrown)}`);
  }
}
