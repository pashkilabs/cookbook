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
    ingredients: ingredientsAsText(
      recipe.ingredients.map((line) => ({
        amount: line.amount,
        unit: line.unit,
        item: line.item,
        note: line.note,
        section: line.section ?? null,
      })),
    ),
    steps: recipe.steps.join("\n"),
    course: recipe.course ?? "",
    cuisine: recipe.cuisine ?? "",
  };
}

/**
 * Ingredient rows as the text a review or edit screen shows — headings included.
 *
 * Shared rather than duplicated, for the reason `draftFrom` already gives about the batch
 * queue: a second screen that shaped its lines differently is a second door to the same
 * insert, and the two drift. They did. The edit screen rebuilt this inline without the
 * heading lines, so **opening any recipe in the editor and saving erased every heading it
 * declared** — the import path was walked end to end and pronounced safe while a second path
 * to the same table quietly deleted the value.
 *
 * Both callers now go through here, which removes the second site rather than watching it.
 */
export function ingredientsAsText(
  lines: ReadonlyArray<{
    amount: number | null;
    unit: string | null;
    item: string;
    note: string | null;
    section: string | null;
  }>,
): string {
  return lines
    .flatMap((line, index, all) => {
      const section = line.section ?? null;
      const previous = index === 0 ? null : (all[index - 1]!.section ?? null);
      const written =
        [formatAsWritten(line.amount, line.unit), line.item].filter(Boolean).join(" ") +
        (line.note ? `, ${line.note}` : "");
      return section !== null && section !== previous ? [`${section}:`, written] : [written];
    })
    .join("\n");
}
