import type {
  ExtractedRecipe,
  Extractor,
  ExtractorUsage,
  Fixture,
  FixtureSet,
} from "./types.js";
import type { FixtureScore, ScoreOptions } from "./score.js";
import { DEFAULT_SCORE_OPTIONS, scoreRecipe } from "./score.js";

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

export interface FixtureOutcome {
  fixture: Fixture;
  status: FixtureStatus;
  /** present when status is "scored" */
  score?: FixtureScore;
  /** present when status is "errored" */
  error?: string;
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
    let produced: ExtractedRecipe | null;
    try {
      produced = await extractor(fixture.input);
    } catch (thrown) {
      outcomes.push({
        fixture,
        status: "errored",
        error: thrown instanceof Error ? thrown.message : String(thrown),
        score: scoreRecipe(fixture.expected, { ingredients: [] }, scoreOptions),
      });
      continue;
    }
    if (produced === null) {
      outcomes.push({ fixture, status: "skipped" });
      continue;
    }
    outcomes.push({
      fixture,
      status: "scored",
      score: scoreRecipe(fixture.expected, produced, scoreOptions),
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
  const overall = emptyTally();
  const cost = { reported: false, usd: 0, inputTokens: 0, outputTokens: 0, models: [] as string[] };

  for (const outcome of outcomes) {
    const { usage } = outcome;
    if (usage) {
      cost.reported = true;
      cost.usd += usage.costUsd ?? 0;
      cost.inputTokens += usage.inputTokens ?? 0;
      cost.outputTokens += usage.outputTokens ?? 0;
      if (usage.model && !cost.models.includes(usage.model)) cost.models.push(usage.model);
    }

    const { score } = outcome;
    if (!score) continue;

    for (const field of score.fields) add(byField[field.field], field.correct);
    for (const result of score.ingredients) {
      add(byField.amount, result.amountCorrect);
      add(byField.unit, result.unitCorrect);
      add(byField.item, result.itemCorrect);
      ingredients.expected += 1;
      if (result.actual) ingredients.found += 1;
    }
    ingredients.spurious += score.spurious.length;
    overall.correct += score.correct;
    overall.total += score.total;
  }

  return {
    label,
    fixtures: outcomes.length,
    scored: outcomes.filter((o) => o.status === "scored").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    errored: outcomes.filter((o) => o.status === "errored").length,
    placeholders: outcomes.filter((o) => o.fixture.placeholder).length,
    byField,
    ingredients,
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
