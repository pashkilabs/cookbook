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
    /*
     * Headings are written back into the text as "Sauce:" lines.
     *
     * The review screen renders this blob and re-parses it on save, so anything not in the text
     * is lost — which is how `section` was computed on every import and discarded at save for as
     * long as the parser has produced it. `parseIngredientList` reads a trailing-colon line with
     * no quantity as a heading, so this round-trips, and a person editing the list can add or
     * move a heading and have it mean something.
     */
    ingredients: recipe.ingredients
      .flatMap((line, index, all) => {
        const section = line.section ?? null;
        const previous = index === 0 ? null : (all[index - 1]!.section ?? null);
        const written =
          [formatAsWritten(line.amount, line.unit), line.item].filter(Boolean).join(" ") +
          (line.note ? `, ${line.note}` : "");
        return section !== null && section !== previous ? [`${section}:`, written] : [written];
      })
      .join("\n"),
    steps: recipe.steps.join("\n"),
    course: recipe.course ?? "",
    cuisine: recipe.cuisine ?? "",
  };
}
