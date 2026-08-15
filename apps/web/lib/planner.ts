import type { SupabaseClient } from "@supabase/supabase-js";
import type { IsoDate } from "./week";

/**
 * Finding or creating the week's plan.
 *
 * `meal_plans` has a partial unique index on `(family_id, week_start) where deleted_at is null`,
 * so a week has at most one live plan. That index is also why this is find-then-insert rather
 * than an upsert: PostgREST cannot name a partial index as an `ON CONFLICT` target — it has no
 * way to restate the predicate. A concurrent insert therefore loses the race with `23505`, which
 * is treated as "somebody else just created it" and re-read rather than reported.
 */
export async function findOrCreateWeek(
  supabase: SupabaseClient,
  familyId: string,
  weekStart: IsoDate,
): Promise<{ id: string } | { message: string; code?: string }> {
  const existing = await supabase
    .from("meal_plans")
    .select("id")
    .eq("family_id", familyId)
    .eq("week_start", weekStart)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.error) return { message: existing.error.message, code: existing.error.code };
  if (existing.data) return { id: existing.data.id };

  const created = await supabase
    .from("meal_plans")
    .insert({ family_id: familyId, week_start: weekStart })
    .select("id")
    .single();
  if (!created.error) return { id: created.data.id };

  if (created.error.code === "23505") {
    const again = await supabase
      .from("meal_plans")
      .select("id")
      .eq("family_id", familyId)
      .eq("week_start", weekStart)
      .is("deleted_at", null)
      .maybeSingle();
    if (again.data) return { id: again.data.id };
  }
  return { message: created.error.message, code: created.error.code };
}

/**
 * Servings, not multipliers.
 *
 * `plan_entries.scale` is still what is **stored** — a batch multiplier is what
 * `packages/core` consolidates against, and the planner already rendered
 * `recipe.servings × scale` to show a number of servings. So the reading existed and only the
 * input was a menu. These invert that computation at the edge and change nothing downstream.
 *
 * Storing servings instead was the alternative and was rejected: `recipes.servings` is nullable,
 * so a recipe with no stated yield has no defined "feed six", while a multiplier is always
 * defined. Decisions §41 records the consequence — editing a recipe's own servings changes what a
 * plan feeds rather than what it multiplies — and why that reading is the honest one.
 */

/** Nobody is cooking for more than this, and a typo should not become a shopping list. */
export const MAX_SERVINGS = 50;
/** The stored multiplier is bounded too, for a recipe with an unusable servings figure. */
export const MAX_SCALE = 50;

/**
 * A typed servings figure, or null if it is not one.
 *
 * Whole people. `2.5` servings is a number a spreadsheet produces, not a person, and admitting
 * fractions here is how `0.3333` ends up in a shopping list.
 */
export function parseServings(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > MAX_SERVINGS) return null;
  return parsed;
}

/**
 * The multiplier that turns a recipe into that many servings.
 *
 * A recipe with no stated yield cannot answer this, so the caller has to ask for a multiplier
 * instead — which is what the planner does, rather than inventing a yield of 1 and quietly
 * multiplying by six.
 */
export function scaleForServings(servings: number, recipeServings: number | null): number | null {
  if (!recipeServings || recipeServings <= 0) return null;
  const scale = servings / recipeServings;
  if (!Number.isFinite(scale) || scale <= 0 || scale > MAX_SCALE) return null;
  // three places is finer than any kitchen and keeps 1/3 from becoming a repeating decimal in the
  // database; the shopping list rounds up to packages anyway
  return Math.round(scale * 1000) / 1000;
}

/** What a stored scale feeds, against the recipe as it stands now. */
export function servingsForScale(scale: number, recipeServings: number | null): number | null {
  if (!recipeServings || recipeServings <= 0) return null;
  return Math.max(1, Math.round(recipeServings * scale));
}

/** A multiplier, for the recipes that cannot express themselves in servings. */
export function parseScale(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_SCALE) return null;
  return Math.round(parsed * 1000) / 1000;
}

/**
 * The recipe's amounts, as the planned meal needs them.
 *
 * The multiplier was reaching the shopping list and nothing else. Somebody who planned a recipe
 * for nine and opened it to cook saw the original amounts — so the figure they typed changed what
 * they bought and not what they made, which is the half that is in your hands at the stove.
 *
 * A scale that is not a usable multiplier returns the lines untouched. The value arrives from a
 * URL, and a stale or hand-edited one must not silently halve somebody's dinner.
 */
export function scaleIngredientAmounts<T extends { amount: number | null }>(
  lines: T[],
  scale: number,
): T[] {
  if (!Number.isFinite(scale) || scale <= 0 || scale === 1) return lines;
  return lines.map((line) => ({
    ...line,
    // an unstated amount is not 1.5 of anything — "salt to taste" stays "salt to taste"
    amount: line.amount === null ? null : line.amount * scale,
  }));
}
