/**
 * The eval harness measures one thing: how close an extractor's output is to a
 * hand-checked recipe. Everything here is data — no network, no filesystem, no
 * model calls — so the same fixtures and scoring run in a test, in CI, and
 * behind whatever inference layer arrives later.
 */

export type FixtureKind = "url" | "caption" | "screenshot";

/**
 * What the extractor is given. Discriminated on `kind` so an extractor can
 * declare, by returning null, that it doesn't handle a shape of input — a
 * text-only extractor being scored on screenshots would report a meaningless
 * zero rather than an honest skip.
 *
 * `text` is the captured raw material. A URL fixture carries a saved snapshot
 * of the page so the eval stays offline and reproducible; re-fetching would
 * make yesterday's score unrepeatable and put a network in `packages/core`.
 */
export type FixtureInput =
  | { kind: "url"; url: string; text?: string }
  | { kind: "caption"; text: string }
  | { kind: "screenshot"; imagePath: string; text?: string };

/** The only ingredient fields the eval scores. Amounts are as written, not in base units. */
export interface EvalIngredient {
  /** null when the line states no quantity ("salt to taste") */
  amount: number | null;
  /** canonical unit key per `canonicalUnit`, or null for whole countable things */
  unit: string | null;
  item: string;
}

/**
 * Hand-checked truth for one fixture. Every field is stated; `null` means the
 * source genuinely gives none, which is different from an extractor missing it.
 */
export interface ExpectedRecipe {
  title: string;
  servings: number | null;
  /** total time in minutes — the base unit for time, so it can be compared */
  totalMinutes: number | null;
  ingredients: EvalIngredient[];
}

export interface Fixture {
  id: string;
  input: FixtureInput;
  expected: ExpectedRecipe;
  /** where it came from, so a suspect expectation can be re-checked against the source */
  source?: string;
  /** true while this demonstrates the format rather than measuring anything */
  placeholder?: boolean;
  notes?: string;
}

export type FixtureSet = readonly Fixture[];

/**
 * What a run cost. Optional because a deterministic extractor costs nothing;
 * a model extractor fills it in and the report sums it.
 */
export interface ExtractorUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** What an extractor produced. Fields may be absent — that scores as a miss, not a crash. */
export interface ExtractedRecipe {
  title?: string | null;
  servings?: number | null;
  totalMinutes?: number | null;
  ingredients?: readonly EvalIngredient[];
  usage?: ExtractorUsage;
}

/**
 * The plug. Return null for an input this extractor doesn't handle; the runner
 * records that as skipped and leaves it out of the accuracy figures.
 */
export type Extractor = (
  input: FixtureInput,
) => ExtractedRecipe | null | Promise<ExtractedRecipe | null>;
