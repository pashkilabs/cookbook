import { parseIngredientList } from "@pashki/core";

/**
 * What a person typed, turned into rows.
 *
 * **Ingredient lines go through `packages/core`'s parser, not a form with separate amount,
 * unit and item fields.** That is the whole point of typing them as text: it is the same path
 * an import will take, so every recipe somebody enters by hand is a test of the parser against
 * real typing — before any model is involved, and without needing a fixture.
 *
 * Shared between create and edit so both normalise identically. Pure, so it is unit-testable
 * and runs the same in a route handler as it would in Expo.
 */
export interface RecipeInput {
  title?: unknown;
  servings?: unknown;
  timeMinutes?: unknown;
  sourceName?: unknown;
  ingredients?: unknown;
  steps?: unknown;
}

export interface PreparedRecipe {
  title: string;
  servings: number | null;
  timeMinutes: number | null;
  sourceName: string | null;
  ingredients: Array<{
    position: number;
    amount: number | null;
    unit: string | null;
    itemText: string;
    note: string;
    isEstimated: boolean;
  }>;
  steps: Array<{ position: number; text: string }>;
}

export type PreparationResult =
  | { ok: true; recipe: PreparedRecipe }
  | { ok: false; error: string };

export function prepareRecipe(input: RecipeInput): PreparationResult {
  const title = asText(input.title, 200);
  if (!title) return { ok: false, error: "a title is required" };

  const servings = asPositiveInteger(input.servings);
  if (servings === "invalid") return { ok: false, error: "servings must be a whole number above zero" };
  const timeMinutes = asPositiveInteger(input.timeMinutes);
  if (timeMinutes === "invalid") return { ok: false, error: "time must be a whole number of minutes" };

  const lines = asLines(input.ingredients);
  const parsed = parseIngredientList(lines);

  return {
    ok: true,
    recipe: {
      title,
      servings,
      timeMinutes,
      sourceName: asText(input.sourceName, 200),
      ingredients: parsed.map((ingredient, index) => ({
        position: index,
        amount: ingredient.amount,
        unit: ingredient.unit,
        itemText: ingredient.item,
        note: ingredient.note,
        // the parser flags an amount it inferred rather than read; the review screen and the
        // detail screen both surface it, so it must survive being typed in too
        isEstimated: ingredient.estimated === true,
      })),
      steps: asLines(input.steps).map((text, index) => ({ position: index, text })),
    },
  };
}

/**
 * One line per ingredient, one per step. Blank lines are dropped rather than becoming empty
 * rows — `item_text` and `text` are both NOT NULL, and a stray newline is not an ingredient.
 */
function asLines(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

/** null for "not given", the string "invalid" for "given and wrong" — they are different. */
function asPositiveInteger(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return "invalid";
  return parsed;
}
