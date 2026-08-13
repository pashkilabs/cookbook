import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedRecipe } from "./recipe-input";
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
