import { formatAsWritten } from "@pashki/core";
import type { ExtractedRecipe } from "@pashki/import";

/**
 * An extracted recipe as the review screen takes it.
 *
 * Shared by the single-URL route and the batch queue on purpose: a batch review that shaped its
 * draft differently would be a second parser reached by a second door, and the two would drift.
 * Ingredients are rendered back to text so that **saving runs `parseIngredientList` either way** —
 * what the person edits is what gets parsed.
 */
export function draftFrom(recipe: ExtractedRecipe) {
  return {
    title: recipe.title,
    servings: recipe.servings === null ? "" : String(recipe.servings),
    timeMinutes: recipe.totalMinutes === null ? "" : String(recipe.totalMinutes),
    sourceName: recipe.sourceName ?? "",
    sourceUrl: recipe.sourceUrl,
    ingredients: recipe.ingredients
      .map((line) =>
        [formatAsWritten(line.amount, line.unit), line.item].filter(Boolean).join(" ") +
        (line.note ? `, ${line.note}` : ""),
      )
      .join("\n"),
    steps: recipe.steps.join("\n"),
    course: recipe.course ?? "",
    cuisine: recipe.cuisine ?? "",
  };
}
