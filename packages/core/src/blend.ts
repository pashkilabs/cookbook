/**
 * Two parts of two recipes, combined **exactly as written** (§60 step 4).
 *
 * ---------------------------------------------------------------------------
 * What this does not do, which is most of it
 * ---------------------------------------------------------------------------
 *
 * **No quantity changes. None.** Not a scale to reconcile servings, not a merge of two garlic
 * lines, not a rounding. §60 settled this against the computational-cooking field's own
 * benchmark: the standard instrument there is a "Recipe Turing Test" — can a person tell the
 * generated ingredient list from a real one — which measures *plausibility, not edibility*.
 * Changing quantities inside a familiar recipe layout is the confident-invention failure at its
 * worst, because nobody discovers it until they have shopped and cooked.
 *
 * So this is concatenation with bookkeeping. The bookkeeping is the whole value: which lines
 * came from where, and a fingerprint that says whether that is still true.
 *
 * ---------------------------------------------------------------------------
 * The ranges index the BLEND's lists, never the source's
 * ---------------------------------------------------------------------------
 *
 * Editing a source tombstones and re-inserts its rows wholesale, because `position` is the only
 * identity an ingredient line has. A stored index into a source would therefore still parse,
 * still look valid, and name different lines — the worst kind of stale, because nothing about
 * it looks wrong.
 *
 * The blend's own lists have the same hazard the moment somebody edits the blend, so every part
 * carries `linesKey`: a fingerprint of the lines it covered when it was written. On read the key
 * is recomputed; a mismatch means the part no longer knows which lines are its own, and the
 * screen says so rather than drawing a heading over the wrong rows. That is EXTRACTOR_VERSION
 * with the human step removed — a stamp only works if somebody turns it, and a fingerprint
 * turns itself.
 *
 * `stepsKey` separately, because the method can be edited without touching an ingredient.
 */
import { fingerprint } from "./fingerprint.js";

export interface BlendLine {
  amount: number | null;
  unit: string | null;
  itemText: string;
  note: string;
  isEstimated: boolean;
  section: string | null;
}

export interface BlendPart {
  sourceRecipeId: string;
  sourceTitle: string;
  /** what this part is called — a component's name, or the source's title for a whole take */
  componentName: string;
  role: string | null;
  taken: "component" | "whole";
  /** whether a person moved the boundaries the model proposed (§61 — they are the evaluator) */
  adjusted: boolean;
  /** the source partition's agreement, snapshotted. Shown when low, never gated on. */
  agreement: number | null;
  readings: number | null;
  ingredients: readonly BlendLine[];
  /** the source's method, whole. Nothing knows which steps make which part — see below. */
  steps: readonly string[];
}

export interface ComposedPart {
  sourceRecipeId: string;
  sourceTitle: string;
  componentName: string;
  role: string | null;
  taken: "component" | "whole";
  adjusted: boolean;
  agreement: number | null;
  readings: number | null;
  ingredientsFrom: number;
  ingredientsTo: number;
  stepsFrom: number | null;
  stepsTo: number | null;
  linesKey: string;
  stepsKey: string | null;
}

export interface ComposedBlend {
  ingredients: Array<BlendLine & { position: number }>;
  steps: Array<{ position: number; text: string }>;
  parts: ComposedPart[];
  /**
   * Null whenever the parts disagree, which is most of the time.
   *
   * Two recipes serving 4 and 2 do not make a recipe serving 4, or 2, or 3. Version one changes
   * no quantities, so there is no honest number here and the screen says which figures the parts
   * were written for instead. A blend is planned by multiplier.
   */
  servings: null;
}

/** the text a line's fingerprint is taken over — what a person would see, not the row's id */
const written = (line: BlendLine): string =>
  [line.amount ?? "", line.unit ?? "", line.itemText, line.note].join(" ").trim();

/**
 * Concatenate the parts and record where each one landed.
 *
 * A part contributing no ingredients is dropped rather than stored as an empty range: an
 * inclusive `from..to` cannot express "nothing", and a range of `0..-1` would be a lie that
 * every later reader has to know about.
 */
export function composeBlend(parts: readonly BlendPart[]): ComposedBlend {
  const ingredients: Array<BlendLine & { position: number }> = [];
  const steps: Array<{ position: number; text: string }> = [];
  const composed: ComposedPart[] = [];

  for (const part of parts) {
    if (part.ingredients.length === 0) continue;

    const ingredientsFrom = ingredients.length;
    for (const line of part.ingredients) {
      ingredients.push({
        ...line,
        /*
         * The part's name becomes the heading, so the blend's structure shows up through the
         * ingredient-heading rendering that already exists rather than through a second
         * mechanism. A whole-recipe take keeps whatever headings the recipe itself declared —
         * taking the whole of something means keeping the shape it came in.
         */
        section: part.taken === "whole" ? line.section : part.componentName,
        position: ingredients.length,
      });
    }
    const ingredientsTo = ingredients.length - 1;

    let stepsFrom: number | null = null;
    let stepsTo: number | null = null;
    let stepsKey: string | null = null;
    if (part.steps.length > 0) {
      stepsFrom = steps.length;
      for (const text of part.steps) steps.push({ position: steps.length, text });
      stepsTo = steps.length - 1;
      stepsKey = fingerprint(part.steps);
    }

    composed.push({
      sourceRecipeId: part.sourceRecipeId,
      sourceTitle: part.sourceTitle,
      componentName: part.componentName,
      // a whole take used no partition, so it claims no role and no agreement
      role: part.taken === "whole" ? null : part.role,
      taken: part.taken,
      adjusted: part.adjusted,
      agreement: part.taken === "whole" ? null : part.agreement,
      readings: part.taken === "whole" ? null : part.readings,
      ingredientsFrom,
      ingredientsTo,
      stepsFrom,
      stepsTo,
      linesKey: fingerprint(part.ingredients.map(written)),
      stepsKey,
    });
  }

  return { ingredients, steps, parts: composed, servings: null };
}

/**
 * Does this part still know which lines are its own?
 *
 * Recomputed on read rather than trusted, so an edit to the blend is noticed instead of silently
 * shifting a heading onto somebody else's ingredients.
 */
export function partIsIntact(
  part: Pick<ComposedPart, "ingredientsFrom" | "ingredientsTo" | "stepsFrom" | "stepsTo" | "linesKey" | "stepsKey">,
  blend: { ingredients: readonly BlendLine[]; steps: readonly string[] },
): boolean {
  const lines = blend.ingredients.slice(part.ingredientsFrom, part.ingredientsTo + 1);
  // a range reaching past the end is stale by itself; slice would quietly return fewer
  if (lines.length !== part.ingredientsTo - part.ingredientsFrom + 1) return false;
  if (fingerprint(lines.map(written)) !== part.linesKey) return false;

  if (part.stepsFrom === null || part.stepsTo === null || part.stepsKey === null) return true;
  const taken = blend.steps.slice(part.stepsFrom, part.stepsTo + 1);
  if (taken.length !== part.stepsTo - part.stepsFrom + 1) return false;
  return fingerprint(taken) === part.stepsKey;
}

/**
 * What the parts were written to serve, when they disagree — for the sentence that says so.
 *
 * Returned as the figures rather than a reconciliation, because reconciling is a quantity change
 * and version one makes none. "The glaze is written for 4 and the cod for 2" is something a cook
 * can act on; a blend claiming to serve 3 is not.
 */
export function servingsDisagreement(
  parts: ReadonlyArray<{ componentName: string; servings: number | null }>,
): Array<{ componentName: string; servings: number }> | null {
  const stated = parts.filter(
    (part): part is { componentName: string; servings: number } => part.servings !== null,
  );
  if (stated.length < 2) return null;
  const first = stated[0]!.servings;
  return stated.every((part) => part.servings === first) ? null : stated;
}
