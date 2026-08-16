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
 *
 * **The snapshot is the extracted markup, not the page.** The JSON-LD `Recipe`
 * node plus the ingredient markup, and nothing else. Real pages run 300–680 KB
 * of ads and scripts each; committing eighteen of those is several megabytes
 * nobody will ever read, and *an unreviewable fixture rots* — its expectation
 * stops being checkable against its input, which is the one thing a fixture is
 * for. The trimmed capture still exercises tiers 0 and 1, which are the tiers
 * that read markup.
 *
 * `capturedAt` and `url` travel with it because a snapshot is a claim about a
 * page at a moment. Without the date, a fixture that stops matching the live
 * page is indistinguishable from a fixture that was always wrong.
 */
export type FixtureInput =
  | { kind: "url"; url: string; text?: string; capturedAt?: string }
  | { kind: "caption"; text: string }
  | {
      kind: "screenshot";
      imagePath: string;
      /**
       * Further frames of the same recipe, when one is not enough.
       *
       * A reel splits its recipe across the on-screen card, the caption and a pinned
       * comment, and the extractor is expected to fuse them into one recipe. A fixture
       * with a single path cannot measure that, so the format allows several — the
       * first is `imagePath` so a one-image fixture stays the simple case.
       */
      extraImagePaths?: string[];
      text?: string;
    };

/** The only ingredient fields the eval scores. Amounts are as written, not in base units. */
export interface EvalIngredient {
  /** null when the line states no quantity ("salt to taste") */
  amount: number | null;
  /** canonical unit key per `canonicalUnit`, or null for whole countable things */
  unit: string | null;
  item: string;
  /**
   * The heading this line sat under — "For the sauce", "Chicken Marinade" — or
   * null where the recipe has no sections (decisions §45).
   *
   * Scored and reported **separately** from the headline accuracy: a wrong
   * section is a display defect and a wrong amount is a shopping defect, and
   * averaging them together hides which one moved. A heading must never appear
   * as an ingredient; an extractor emitting one has produced a spurious line.
   */
  section?: string | null;
}

/**
 * Hand-checked truth for one fixture. Every field is stated; `null` means the
 * source genuinely gives none, which is different from an extractor missing it.
 */
export interface ExpectedRecipe {
  /**
   * null when the source names no dish.
   *
   * A caption that says "Here are the toast details" and never names the thing has no title, and
   * a fixture set that answers `Summer Toasts` teaches an extractor to invent one — the same
   * disease as teaching it to invent amounts. Absence has to be statable or it becomes a guess
   * with a hand-checked stamp on it.
   */
  title: string | null;
  servings: number | null;
  /** total time in minutes — the base unit for time, so it can be compared */
  totalMinutes: number | null;
  ingredients: EvalIngredient[];
}

/**
 * Why an input has no recipe in it. A closed set, because the reason decides
 * what the product offers next (decisions §46):
 *
 *   no-recipe-in-source  the source withholds it — "comment CHICKEN and I'll DM
 *                        you the full recipe". Offer: paste the DM, or a screenshot.
 *   not-a-recipe-page    a listing, a forum thread, an index. Offer: nothing —
 *                        the URL is simply the wrong one.
 *   unresolvable-source  Facebook, Instagram, TikTok. These never resolve, and
 *                        CLAUDE.md already says to reject them up front rather
 *                        than letting somebody wait through four doomed attempts.
 *                        Offer: the screenshot or video route.
 *   image-only-source    a recipe that is genuinely there and genuinely a
 *                        picture — a scanned page, a photographed card. Not the
 *                        same claim as "not a recipe page": the text route
 *                        cannot read it, and the vision route can.
 */
export type RefusalReason =
  | "no-recipe-in-source"
  | "not-a-recipe-page"
  | "unresolvable-source"
  | "image-only-source";

export const REFUSAL_REASONS: readonly RefusalReason[] = [
  "no-recipe-in-source",
  "not-a-recipe-page",
  "unresolvable-source",
  "image-only-source",
];

/**
 * What the right answer is: a recipe, or a refusal naming why.
 *
 * A refusal has to be statable as an *expectation*, because for some inputs it
 * is the correct output and a plausible recipe is the worst possible one —
 * confident, invented, and indistinguishable from a real answer by anybody who
 * did not already know the dish.
 */
export type Expectation =
  | { outcome: "recipe"; recipe: ExpectedRecipe }
  | { outcome: "refusal"; because: RefusalReason };

export interface Fixture {
  id: string;
  input: FixtureInput;
  expected: Expectation;
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

/**
 * What an extractor produced. Absent fields are read as null when scoring, so
 * omitting a field and asserting it null are the same answer — an extractor is
 * measured on what it extracted, not on how its wrapper serialises nothing.
 */
export interface ExtractedRecipe {
  /**
   * Which tier produced this, when the extractor is a cascade.
   *
   * Carried because "how often does the free deterministic path answer" is the
   * question that decides how much tier 2 has to earn. It was being discarded.
   */
  tier?: string;
  title?: string | null;
  servings?: number | null;
  totalMinutes?: number | null;
  ingredients?: readonly EvalIngredient[];
  usage?: ExtractorUsage;
}

/**
 * "I read this, and there is no recipe in it."
 *
 * Distinct from `null`, which means "I do not handle this *kind* of input" and
 * is recorded as skipped. Reusing null for both would let an extractor that
 * skips everything score perfectly on every refusal fixture — no result read as
 * a pass, which is the trap this repo has now hit three times.
 */
export interface ExtractorRefusal {
  refused: { because: RefusalReason };
  usage?: ExtractorUsage;
}

export type ExtractorOutput = ExtractedRecipe | ExtractorRefusal;

export const isRefusal = (output: ExtractorOutput): output is ExtractorRefusal =>
  "refused" in output && output.refused !== undefined;

/**
 * The plug. Return null for an input this extractor doesn't handle; the runner
 * records that as skipped and leaves it out of the accuracy figures.
 */
export type Extractor = (
  input: FixtureInput,
) => ExtractorOutput | null | Promise<ExtractorOutput | null>;
