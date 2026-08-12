import type { EvalIngredient, ExpectedRecipe, ExtractedRecipe } from "./types.js";
import { lightName } from "../src/text.js";
import { canonicalUnit } from "../src/units.js";

export interface ScoreOptions {
  /** fraction of the expected amount tolerated, so 240 ml passes for 1 cup */
  amountRelativeTolerance: number;
  /** absolute floor, so 0.333 passes for ⅓ where a percentage alone would not */
  amountAbsoluteTolerance: number;
  /** below this item similarity, two lines are treated as different ingredients */
  matchThreshold: number;
}

export const DEFAULT_SCORE_OPTIONS: ScoreOptions = {
  amountRelativeTolerance: 0.02,
  amountAbsoluteTolerance: 0.01,
  matchThreshold: 0.5,
};

/** Shown where there is no value to show. */
export const MISSING = "—";

export type RecipeFieldName = "title" | "servings" | "totalMinutes";
export type IngredientFieldName = "amount" | "unit" | "item";

export const RECIPE_FIELDS: readonly RecipeFieldName[] = ["title", "servings", "totalMinutes"];

export interface FieldResult {
  field: RecipeFieldName;
  correct: boolean;
  /** display strings, kept on the result so the diff needs no second pass */
  expected: string;
  actual: string;
}

export interface IngredientResult {
  expected: EvalIngredient;
  /** null when nothing in the output matched this ingredient */
  actual: EvalIngredient | null;
  amountCorrect: boolean;
  unitCorrect: boolean;
  itemCorrect: boolean;
}

export interface FixtureScore {
  fields: FieldResult[];
  ingredients: IngredientResult[];
  /** output lines that matched no expected ingredient */
  spurious: EvalIngredient[];
  correct: number;
  total: number;
  /**
   * Which fields the extractor actually put in its output. Absence does not
   * affect the score — but an extractor that never emits a field on any fixture
   * is worth one warning, which the runner aggregates from this.
   */
  emitted: Record<RecipeFieldName, boolean>;
}

/**
 * What the scorer compares: absence collapsed into null.
 *
 * A field omitted from the output and a field asserted as null are the same
 * answer. Grading them differently would grade the serialisation convention of
 * whatever wrapper produced the output — schema-constrained model output
 * routinely omits nulls, and the wrapper controls presence, not the model.
 */
interface NormalisedRecipe {
  title: string | null;
  servings: number | null;
  totalMinutes: number | null;
  ingredients: readonly EvalIngredient[];
}

function normaliseExtracted(actual: ExtractedRecipe): NormalisedRecipe {
  return {
    title: actual.title ?? null,
    servings: actual.servings ?? null,
    totalMinutes: actual.totalMinutes ?? null,
    ingredients: actual.ingredients ?? [],
  };
}

/**
 * Titles keep their commas and internal punctuation — "Chicken, Two Ways" is
 * not "Chicken". Only case and whitespace are forgiven.
 */
export function normaliseTitle(input: string | null | undefined): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/\.\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deliberately the gentle normaliser: `normaliseName` would strip "diced" and
 * let an extractor that turned a tin of diced tomatoes into fresh tomatoes
 * score as correct. That is the exact bug the core tests guard against, so the
 * eval must not forgive it.
 */
export function normaliseItem(input: string | null | undefined): string {
  return lightName(String(input ?? ""));
}

/** null and "count" are the same claim — no unit — written two ways. */
export function normaliseUnit(input: string | null | undefined): string | null {
  const canonical = canonicalUnit(input);
  return canonical === "count" ? null : canonical;
}

export function amountsMatch(
  expected: number | null,
  actual: number | null | undefined,
  options: ScoreOptions = DEFAULT_SCORE_OPTIONS,
): boolean {
  const got = actual ?? null;
  if (expected === null || got === null) return expected === got;
  if (!Number.isFinite(got)) return false;
  const tolerance = Math.max(
    options.amountAbsoluteTolerance,
    options.amountRelativeTolerance * Math.abs(expected),
  );
  return Math.abs(expected - got) <= tolerance;
}

/** Dice coefficient over words. Used only to pair lines up, never to score them. */
export function itemSimilarity(a: string, b: string): number {
  const left = normaliseItem(a);
  const right = normaliseItem(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared += 1;
  return (2 * shared) / (leftWords.size + rightWords.size);
}

/**
 * Pair expected ingredients with output lines by item similarity, best pair
 * first. Index-by-index comparison would be wrong: one missing line shifts
 * everything after it and turns a single error into a wall of noise.
 *
 * Ties break on position, so the same fixture always produces the same diff.
 */
function pairIngredients(
  expected: readonly EvalIngredient[],
  actual: readonly EvalIngredient[],
  threshold: number,
): { pairs: Map<number, number>; spurious: number[] } {
  const candidates: Array<{ score: number; e: number; a: number }> = [];
  for (const [e, want] of expected.entries()) {
    for (const [a, got] of actual.entries()) {
      const score = itemSimilarity(want.item, got.item);
      if (score >= threshold) candidates.push({ score, e, a });
    }
  }
  candidates.sort((x, y) => y.score - x.score || x.e - y.e || x.a - y.a);

  const pairs = new Map<number, number>();
  const takenActual = new Set<number>();
  for (const { e, a } of candidates) {
    if (pairs.has(e) || takenActual.has(a)) continue;
    pairs.set(e, a);
    takenActual.add(a);
  }
  const spurious = actual.map((_, a) => a).filter((a) => !takenActual.has(a));
  return { pairs, spurious };
}

/**
 * Score one extraction against its hand-checked truth.
 *
 * Every check counts once: three recipe fields, three fields per expected
 * ingredient, and one per spurious line. Missing ingredients fail all three of
 * their checks — so an extractor cannot score well on amounts by finding only
 * the ingredients whose amounts are easy.
 */
export function scoreRecipe(
  expected: ExpectedRecipe,
  actual: ExtractedRecipe,
  options: ScoreOptions = DEFAULT_SCORE_OPTIONS,
): FixtureScore {
  const got = normaliseExtracted(actual);
  const fields: FieldResult[] = [
    {
      field: "title",
      correct: got.title !== null && normaliseTitle(expected.title) === normaliseTitle(got.title),
      expected: expected.title,
      actual: got.title ?? MISSING,
    },
    {
      field: "servings",
      correct: amountsMatch(expected.servings, got.servings, options),
      expected: numberDisplay(expected.servings),
      actual: numberDisplay(got.servings),
    },
    {
      field: "totalMinutes",
      correct: amountsMatch(expected.totalMinutes, got.totalMinutes, options),
      expected: minutesDisplay(expected.totalMinutes),
      actual: minutesDisplay(got.totalMinutes),
    },
  ];

  const produced = got.ingredients;
  const { pairs, spurious } = pairIngredients(
    expected.ingredients,
    produced,
    options.matchThreshold,
  );

  const ingredients: IngredientResult[] = expected.ingredients.map((want, index) => {
    const matchedIndex = pairs.get(index);
    const got = matchedIndex === undefined ? null : produced[matchedIndex] ?? null;
    if (!got) {
      return {
        expected: want,
        actual: null,
        amountCorrect: false,
        unitCorrect: false,
        itemCorrect: false,
      };
    }
    return {
      expected: want,
      actual: got,
      amountCorrect: amountsMatch(want.amount, got.amount, options),
      unitCorrect: normaliseUnit(want.unit) === normaliseUnit(got.unit),
      itemCorrect: normaliseItem(want.item) === normaliseItem(got.item),
    };
  });

  let correct = fields.filter((f) => f.correct).length;
  for (const result of ingredients) {
    if (result.amountCorrect) correct += 1;
    if (result.unitCorrect) correct += 1;
    if (result.itemCorrect) correct += 1;
  }
  const total = fields.length + ingredients.length * 3 + spurious.length;

  return {
    fields,
    ingredients,
    spurious: spurious.map((a) => produced[a]).filter((x): x is EvalIngredient => x !== undefined),
    correct,
    total,
    emitted: {
      title: actual.title !== undefined,
      servings: actual.servings !== undefined,
      totalMinutes: actual.totalMinutes !== undefined,
    },
  };
}

function numberDisplay(value: number | null | undefined): string {
  return value == null ? "none" : String(value);
}

function minutesDisplay(value: number | null | undefined): string {
  return value == null ? "none" : `${value} min`;
}
