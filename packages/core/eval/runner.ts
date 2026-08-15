import type {
  ExtractedRecipe,
  Extractor,
  ExtractorOutput,
  ExtractorUsage,
  Fixture,
  FixtureSet,
} from "./types.js";
import { isRefusal } from "./types.js";
import type { FixtureScore, RecipeFieldName, RefusalScore, ScoreOptions } from "./score.js";
import { DEFAULT_SCORE_OPTIONS, RECIPE_FIELDS, scoreRecipe, scoreRefusal } from "./score.js";

export interface RunOptions {
  /** names the extractor in the report; defaults to the function's own name */
  label?: string;
  score?: Partial<ScoreOptions>;
}

export interface Tally {
  correct: number;
  total: number;
}

export type FixtureStatus = "scored" | "skipped" | "errored";

/** An empty recipe, for the cases where an extractor produced no usable answer. */
const NOTHING: ExtractedRecipe = { ingredients: [] };

export interface FixtureOutcome {
  fixture: Fixture;
  status: FixtureStatus;
  /** present when status is "scored" */
  score?: FixtureScore;
  /** present when status is "errored" */
  error?: string;
  /** present when the fixture's correct answer is a refusal */
  refusal?: RefusalScore;
  /** the extractor declined a fixture that does have a recipe */
  falseRefusal?: boolean;
  usage?: ExtractorUsage;
}

export interface EvalReport {
  label: string;
  fixtures: number;
  scored: number;
  skipped: number;
  errored: number;
  /** how many of the scored fixtures are still shape demonstrations */
  placeholders: number;
  byField: {
    title: Tally;
    servings: Tally;
    totalMinutes: Tally;
    amount: Tally;
    unit: Tally;
    item: Tally;
  };
  ingredients: {
    expected: number;
    found: number;
    spurious: number;
  };
  /**
   * Fields the extractor never emitted on any scored fixture. Absence scores the
   * same as an asserted null, so a field nobody ever attempts would otherwise
   * vanish into a low per-field percentage — this surfaces it once.
   */
  neverEmitted: RecipeFieldName[];
  /**
   * Headings, tallied apart from the field accuracies on purpose (decisions §45):
   * a wrong section misgroups a display, a wrong amount buys the wrong food.
   */
  sections: Tally;
  refusals: {
    /** fixtures whose correct answer is a refusal */
    expected: number;
    /** and were declined rather than answered with a recipe */
    refused: number;
    /** and named the right reason */
    reasonCorrect: number;
    /** recipes invented for inputs that contain none — the failure that matters */
    confabulated: number;
    inventedIngredients: number;
    /** real recipes the extractor declined */
    falseRefusals: number;
  };
  overall: Tally;
  cost: {
    /** false when no extractor reported usage — a deterministic run, or one that didn't say */
    reported: boolean;
    usd: number;
    inputTokens: number;
    outputTokens: number;
    models: string[];
  };
  outcomes: FixtureOutcome[];
}

/**
 * Run a fixture set through an extractor.
 *
 * Skipped fixtures are left out of every accuracy figure and counted in the
 * header instead: a text-only extractor scored 0% on screenshots would report a
 * number that says nothing about the extractor. A fixture that throws is
 * recorded and its checks counted as failures, so one bad input degrades the
 * score rather than killing the run.
 */
export async function runEval(
  fixtures: FixtureSet,
  extractor: Extractor,
  options: RunOptions = {},
): Promise<EvalReport> {
  const scoreOptions: ScoreOptions = { ...DEFAULT_SCORE_OPTIONS, ...options.score };
  const outcomes: FixtureOutcome[] = [];

  for (const fixture of fixtures) {
    const expectation = fixture.expected;

    let produced: ExtractorOutput | null;
    try {
      produced = await extractor(fixture.input);
    } catch (thrown) {
      const error = thrown instanceof Error ? thrown.message : String(thrown);
      outcomes.push(
        expectation.outcome === "refusal"
          ? { fixture, status: "errored", error, refusal: scoreRefusal(expectation.because, null) }
          : {
              fixture,
              status: "errored",
              error,
              score: scoreRecipe(expectation.recipe, NOTHING, scoreOptions),
            },
      );
      continue;
    }

    if (produced === null) {
      outcomes.push({ fixture, status: "skipped" });
      continue;
    }

    if (expectation.outcome === "refusal") {
      const answer = isRefusal(produced)
        ? scoreRefusal(expectation.because, produced.refused.because)
        : scoreRefusal(expectation.because, null, (produced.ingredients ?? []).length);
      outcomes.push({ fixture, status: "scored", refusal: answer, usage: produced.usage });
      continue;
    }

    if (isRefusal(produced)) {
      /*
       * A refusal where a recipe exists. Every check fails — the same answer as
       * extracting nothing — and it is counted separately, because "declined a real
       * recipe" and "read one badly" call for different fixes.
       */
      outcomes.push({
        fixture,
        status: "scored",
        score: scoreRecipe(expectation.recipe, NOTHING, scoreOptions),
        falseRefusal: true,
        usage: produced.usage,
      });
      continue;
    }

    outcomes.push({
      fixture,
      status: "scored",
      score: scoreRecipe(expectation.recipe, produced, scoreOptions),
      usage: produced.usage,
    });
  }

  return summarise(options.label ?? extractor.name ?? "extractor", outcomes);
}

function summarise(label: string, outcomes: FixtureOutcome[]): EvalReport {
  const byField = {
    title: emptyTally(),
    servings: emptyTally(),
    totalMinutes: emptyTally(),
    amount: emptyTally(),
    unit: emptyTally(),
    item: emptyTally(),
  };
  const ingredients = { expected: 0, found: 0, spurious: 0 };
  const sections = emptyTally();
  const refusals = {
    expected: 0, refused: 0, reasonCorrect: 0,
    confabulated: 0, inventedIngredients: 0, falseRefusals: 0,
  };
  const overall = emptyTally();
  const cost = { reported: false, usd: 0, inputTokens: 0, outputTokens: 0, models: [] as string[] };
  const emitted: Record<RecipeFieldName, number> = { title: 0, servings: 0, totalMinutes: 0 };
  let scored = 0;

  for (const outcome of outcomes) {
    const { usage } = outcome;
    if (usage) {
      cost.reported = true;
      cost.usd += usage.costUsd ?? 0;
      cost.inputTokens += usage.inputTokens ?? 0;
      cost.outputTokens += usage.outputTokens ?? 0;
      if (usage.model && !cost.models.includes(usage.model)) cost.models.push(usage.model);
    }

    if (outcome.falseRefusal) refusals.falseRefusals += 1;

    /*
     * A refusal fixture is one check in the headline — "did it decline" is one
     * question. The reason rides alongside rather than inside, so refusing for the
     * wrong reason is visible without swamping the field accuracies (decisions §46).
     */
    const { refusal } = outcome;
    if (refusal) {
      if (outcome.status === "scored") scored += 1;
      refusals.expected += 1;
      overall.total += 1;
      if (refusal.refused) {
        refusals.refused += 1;
        overall.correct += 1;
        if (refusal.reasonCorrect) refusals.reasonCorrect += 1;
      } else {
        refusals.confabulated += 1;
        refusals.inventedIngredients += refusal.invented;
      }
      continue;
    }

    const { score } = outcome;
    if (!score) continue;

    // only what the extractor actually returned counts as an attempt; a fixture
    // that threw emitted nothing for reasons that aren't about the field
    if (outcome.status === "scored") {
      scored += 1;
      for (const field of RECIPE_FIELDS) if (score.emitted[field]) emitted[field] += 1;
    }

    for (const field of score.fields) add(byField[field.field], field.correct);
    for (const result of score.ingredients) {
      add(byField.amount, result.amountCorrect);
      add(byField.unit, result.unitCorrect);
      add(byField.item, result.itemCorrect);
      ingredients.expected += 1;
      if (result.actual) ingredients.found += 1;
      if (result.sectionChecked) add(sections, result.sectionCorrect);
    }
    ingredients.spurious += score.spurious.length;
    overall.correct += score.correct;
    overall.total += score.total;
  }

  return {
    label,
    sections,
    refusals,
    fixtures: outcomes.length,
    scored: outcomes.filter((o) => o.status === "scored").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    errored: outcomes.filter((o) => o.status === "errored").length,
    placeholders: outcomes.filter((o) => o.fixture.placeholder).length,
    byField,
    ingredients,
    neverEmitted: scored === 0 ? [] : RECIPE_FIELDS.filter((field) => emitted[field] === 0),
    overall,
    cost,
    outcomes,
  };
}

function emptyTally(): Tally {
  return { correct: 0, total: 0 };
}

function add(tally: Tally, correct: boolean): void {
  tally.total += 1;
  if (correct) tally.correct += 1;
}
