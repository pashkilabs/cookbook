import { createCatalog, estimateEnergy, formatEnergy, roundEnergy } from "@pashki/core";
import { catalogItemsFromRows } from "@pashki/db/catalog";
import type { IngredientRow } from "@pashki/db/catalog";
import type { ParsedIngredient } from "@pashki/core";

/**
 * What a recipe is worth in energy, ready to put on a screen.
 *
 * **Every judgement stays in `packages/core`.** Whether a figure is worth stating at all — the
 * zero rule, the half-the-ingredients threshold, the rounding — is `formatEnergy`'s decision, and
 * this asks it rather than reimplementing it. What is left here is layout: core returns one
 * bundled string ("at least ~680 · 1 ingredient unknown") and a screen needs the parts in a
 * different order, with "kcal per serving" in the middle of it.
 *
 * The catalog is built from `ingredients` alone, with no package sizes. Packages describe how a
 * thing is *sold*, which the shopping list needs and energy does not.
 */
export interface RecipeEnergy {
  /** false when core declined to state a figure at all — too little of the recipe is known */
  stated: boolean;
  /** null when the recipe does not say what it yields */
  perServing: number | null;
  total: number;
  /** true when the figure is a floor rather than an estimate */
  isFloor: boolean;
  /** ingredients carrying no figure, by the text the recipe wrote */
  unknown: string[];
  /** lines counted as carrying no energy — salt, water. Not gaps. */
  negligibleCount: number;
}

export interface EnergyInput {
  amount: number | string | null;
  unit: string | null;
  item_text: string;
  note: string | null;
}

export function energyForRecipe(
  lines: EnergyInput[],
  ingredientRows: IngredientRow[],
  options: { servings: number | null; scale: number },
): RecipeEnergy | null {
  if (!lines.length) return null;

  const catalog = createCatalog(catalogItemsFromRows(ingredientRows, []));
  const ingredients: ParsedIngredient[] = lines.map((line) => ({
    amount: line.amount === null ? null : Number(line.amount),
    unit: line.unit,
    item: line.item_text,
    note: line.note ?? "",
    raw: line.item_text,
  }));

  /*
   * The multiplier applies to the food *and* to the mouths it feeds, so it cancels in the
   * per-serving figure and survives in the total. Planning a roast for nine does not make a
   * serving of it more fattening; it makes nine servings.
   */
  const scale = options.scale > 0 ? options.scale : 1;
  const servings =
    options.servings && options.servings > 0 ? options.servings * scale : null;

  const estimate = estimateEnergy(
    [{ label: "recipe", ingredients, scale }],
    catalog,
    { servings },
  );

  // core decides whether anything may be stated; a refusal here is a refusal everywhere
  const statesTotal = formatEnergy(estimate) !== "no estimate";
  if (!statesTotal) {
    return {
      stated: false,
      perServing: null,
      total: 0,
      isFloor: !estimate.complete,
      unknown: estimate.unresolved,
      negligibleCount: estimate.negligible.length,
    };
  }

  const statesServing =
    servings !== null && formatEnergy(estimate, "serving") !== "no estimate";

  return {
    stated: true,
    perServing: statesServing ? roundEnergy(estimate.perServing ?? 0) : null,
    total: roundEnergy(estimate.kcal),
    isFloor: !estimate.complete,
    unknown: estimate.unresolved,
    negligibleCount: estimate.negligible.length,
  };
}

/** A list of names as a person would say it: "a, b and c". */
export function andList(names: string[], limit = 3): string {
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  const joined =
    shown.length <= 1
      ? (shown[0] ?? "")
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}
