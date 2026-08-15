import { describe, expect, it } from "vitest";
import type { ExpectedRecipe, Extractor, Fixture, RefusalReason } from "../eval/types.js";
import { coreParser } from "../eval/extractors/core-parser.js";
import { FIXTURES } from "../eval/fixtures/index.js";
import { formatReport } from "../eval/report.js";
import { runEval } from "../eval/runner.js";
import { amountsMatch, itemSimilarity, scoreRecipe } from "../eval/score.js";
import { validateFixtures } from "../eval/validate.js";

const recipe = (over: Partial<ExpectedRecipe> = {}): ExpectedRecipe => ({
  title: "Cream Thing",
  servings: 2,
  totalMinutes: 10,
  ingredients: [{ amount: 1, unit: "cup", item: "heavy cream" }],
  ...over,
});

const fixture = (over: Partial<Fixture> = {}): Fixture => ({
  id: "test",
  input: { kind: "caption", text: "1 cup heavy cream" },
  expected: { outcome: "recipe", recipe: recipe() },
  ...over,
});

/** the expected recipe of a fixture, for the tests that score one directly */
const recipeOf = (f: Fixture): ExpectedRecipe =>
  f.expected.outcome === "recipe" ? f.expected.recipe : recipe();

describe("amount tolerance", () => {
  it("accepts a metric restatement of a cup", () => {
    expect(amountsMatch(236.588, 240)).toBe(true);
  });

  it("accepts a decimal written for a fraction", () => {
    expect(amountsMatch(1 / 3, 0.33)).toBe(true);
  });

  it("rejects an amount that is merely close in magnitude", () => {
    expect(amountsMatch(2, 3)).toBe(false);
    expect(amountsMatch(14.5, 15)).toBe(false);
  });

  it("treats a stated quantity and no quantity as different answers", () => {
    expect(amountsMatch(null, null)).toBe(true);
    expect(amountsMatch(null, 1)).toBe(false);
    expect(amountsMatch(1, null)).toBe(false);
  });
});

describe("scoring one recipe", () => {
  it("forgives unit spelling but not the unit itself", () => {
    const score = scoreRecipe(recipeOf(fixture()), {
      ingredients: [{ amount: 1, unit: "cups", item: "heavy cream" }],
    });
    expect(score.ingredients[0]?.unitCorrect).toBe(true);

    const wrong = scoreRecipe(recipeOf(fixture()), {
      ingredients: [{ amount: 1, unit: "tbsp", item: "heavy cream" }],
    });
    expect(wrong.ingredients[0]?.unitCorrect).toBe(false);
  });

  it("treats a null unit and an explicit count as the same claim", () => {
    const expected = recipe({
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 2, unit: null, item: "eggs" }],
    });
    const score = scoreRecipe(expected, {
      ingredients: [{ amount: 2, unit: "count", item: "eggs" }],
    });
    expect(score.ingredients[0]?.unitCorrect).toBe(true);
  });

  it("does not forgive a tin of diced tomatoes turning into fresh tomatoes", () => {
    // the prep word is load-bearing: two different products, so scoring must
    // use the gentle normaliser and mark this wrong
    const expected = recipe({
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 14.5, unit: "oz", item: "diced tomatoes" }],
    });
    const score = scoreRecipe(expected, {
      ingredients: [{ amount: 14.5, unit: "oz", item: "tomatoes" }],
    });
    expect(score.ingredients[0]?.itemCorrect).toBe(false);
  });

  it("counts an omitted field as wrong when the source does state one", () => {
    const score = scoreRecipe(recipeOf(fixture()), { ingredients: [] });
    expect(score.fields.every((f) => !f.correct)).toBe(true);
    expect(score.correct).toBe(0);
  });

  it("reads an omitted field as null, so serialisation convention is not graded", () => {
    // schema-constrained model output routinely omits nulls, and the wrapper
    // controls field presence — grading it would grade our own adapter
    const expected = recipe({
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 1, unit: "cup", item: "heavy cream" }],
    });
    const timeOf = (actual: Parameters<typeof scoreRecipe>[1]): boolean | undefined =>
      scoreRecipe(expected, actual).fields.find((f) => f.field === "totalMinutes")?.correct;

    expect(timeOf({ ingredients: [] })).toBe(true);
    expect(timeOf({ totalMinutes: null, ingredients: [] })).toBe(true);
    expect(timeOf({ totalMinutes: 30, ingredients: [] })).toBe(false);
  });

  it("fails all three checks for an ingredient it never found", () => {
    const score = scoreRecipe(recipeOf(fixture()), {
      title: "Cream Thing",
      servings: 2,
      totalMinutes: 10,
      ingredients: [],
    });
    expect(score.ingredients[0]).toMatchObject({
      actual: null,
      amountCorrect: false,
      unitCorrect: false,
      itemCorrect: false,
    });
    expect(score.correct).toBe(3);
    expect(score.total).toBe(6);
  });

  it("charges a check for every line the extractor invented", () => {
    const score = scoreRecipe(recipeOf(fixture()), {
      title: "Cream Thing",
      servings: 2,
      totalMinutes: 10,
      ingredients: [
        { amount: 1, unit: "cup", item: "heavy cream" },
        { amount: null, unit: null, item: "for the sauce" },
      ],
    });
    expect(score.spurious.map((s) => s.item)).toEqual(["for the sauce"]);
    expect(score.correct).toBe(6);
    expect(score.total).toBe(7);
  });

  it("pairs ingredients by name so one missing line does not misalign the rest", () => {
    const expected = recipe({
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [
          { amount: 1, unit: "cup", item: "heavy cream" },
          { amount: 3, unit: "clove", item: "garlic" },
          { amount: 2, unit: "tbsp", item: "olive oil" },
        ],
    });
    // garlic is absent; naive index comparison would also fail olive oil
    const score = scoreRecipe(expected, {
      ingredients: [
        { amount: 1, unit: "cup", item: "heavy cream" },
        { amount: 2, unit: "tbsp", item: "olive oil" },
      ],
    });
    expect(score.ingredients.map((r) => r.actual?.item ?? null)).toEqual([
      "heavy cream",
      null,
      "olive oil",
    ]);
    expect(score.spurious).toHaveLength(0);
  });

  it("pairs a near-miss name rather than reporting it missing and invented", () => {
    const score = scoreRecipe(recipeOf(fixture()), {
      ingredients: [{ amount: 1, unit: "cup", item: "cream" }],
    });
    expect(score.ingredients[0]?.actual?.item).toBe("cream");
    expect(score.ingredients[0]?.itemCorrect).toBe(false);
    expect(score.ingredients[0]?.amountCorrect).toBe(true);
    expect(score.spurious).toHaveLength(0);
  });

  it("keeps unrelated ingredients apart", () => {
    expect(itemSimilarity("kosher salt", "salt and pepper")).toBeLessThan(0.5);
    expect(itemSimilarity("heavy cream", "cream")).toBeGreaterThanOrEqual(0.5);
  });
});

describe("the runner", () => {
  it("skips inputs the extractor declines instead of scoring them zero", async () => {
    const declines: Extractor = () => null;
    const report = await runEval([fixture()], declines, { label: "declines" });
    expect(report.skipped).toBe(1);
    expect(report.scored).toBe(0);
    expect(report.overall.total).toBe(0);
  });

  it("records a thrown error without losing the rest of the run", async () => {
    const throwsOnSecond: Extractor = (input) => {
      if (input.kind === "caption" && input.text.includes("boom")) throw new Error("boom");
      return { title: "Cream Thing", servings: 2, totalMinutes: 10, ingredients: [] };
    };
    const report = await runEval(
      [
        fixture({ id: "ok" }),
        fixture({ id: "bad", input: { kind: "caption", text: "boom" } }),
      ],
      throwsOnSecond,
    );
    expect(report.errored).toBe(1);
    expect(report.scored).toBe(1);
    expect(report.outcomes[1]?.error).toBe("boom");
    // the failed fixture's checks still count against the score
    expect(report.overall.total).toBe(12);
  });

  it("sums cost across fixtures when an extractor reports it", async () => {
    const priced: Extractor = () => ({
      ingredients: [],
      usage: { model: "some-model", inputTokens: 100, outputTokens: 20, costUsd: 0.0001 },
    });
    const report = await runEval([fixture(), fixture({ id: "second" })], priced);
    expect(report.cost).toMatchObject({
      reported: true,
      inputTokens: 200,
      outputTokens: 40,
      models: ["some-model"],
    });
    expect(report.cost.usd).toBeCloseTo(0.0002);
  });

  it("reports no cost for a deterministic extractor rather than implying zero spend", async () => {
    const report = await runEval([fixture()], coreParser);
    expect(report.cost.reported).toBe(false);
  });
});

describe("the report", () => {
  it("shows what to change, not just a percentage", async () => {
    const confused: Extractor = () => ({
      title: "Cream Thing",
      servings: 6,
      ingredients: [
        { amount: 2, unit: "tbsp", item: "heavy cream" },
        { amount: null, unit: null, item: "for the sauce" },
      ],
    });
    const text = formatReport(await runEval([fixture()], confused, { label: "confused" }));

    expect(text).toContain("eval — confused");
    expect(text).toContain("servings");
    expect(text).toContain("expected 2");
    expect(text).toContain("got 6");
    expect(text).toContain("time");
    expect(text).toContain("amount+unit");
    expect(text).toContain(`"heavy cream"`);
    expect(text).toContain("spurious");
    expect(text).toContain(`"for the sauce"`);
  });

  it("warns once for a field nobody ever attempted, instead of N quiet failures", async () => {
    const noTime: Extractor = () => ({
      title: "Cream Thing",
      servings: 2,
      ingredients: [{ amount: 1, unit: "cup", item: "heavy cream" }],
    });
    const report = await runEval([fixture({ id: "a" }), fixture({ id: "b" })], noTime);
    expect(report.neverEmitted).toEqual(["totalMinutes"]);
    expect(formatReport(report)).toContain("!! time was never emitted across 2 fixtures");
  });

  it("does not warn about a field the extractor answers, even when the answer is null", async () => {
    const asserts: Extractor = () => ({
      title: "Cream Thing",
      servings: 2,
      totalMinutes: null,
      ingredients: [{ amount: 1, unit: "cup", item: "heavy cream" }],
    });
    const report = await runEval([fixture()], asserts);
    expect(report.neverEmitted).toEqual([]);
    expect(formatReport(report)).not.toContain("never emitted");
  });

  it("says so loudly while the fixture set is still placeholders", async () => {
    const text = formatReport(await runEval(FIXTURES, coreParser));
    expect(text).toContain("every fixture is a placeholder");
  });
});

describe("fixture validation", () => {
  it("passes the committed set", () => {
    expect(validateFixtures(FIXTURES)).toEqual([]);
  });

  it("catches a mistyped unit", () => {
    const bad = fixture({
      expected: { outcome: "recipe", recipe: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 1, unit: "tbps", item: "cream" }],
      } },
    });
    expect(validateFixtures([bad]).join("\n")).toContain("is not a unit");
  });

  it("nudges an alias towards its canonical spelling", () => {
    const bad = fixture({
      expected: { outcome: "recipe", recipe: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 1, unit: "tablespoons", item: "cream" }],
      } },
    });
    expect(validateFixtures([bad]).join("\n")).toContain(`write "tbsp"`);
  });

  it("catches a count written as a unit instead of null", () => {
    const bad = fixture({
      expected: { outcome: "recipe", recipe: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 2, unit: "large", item: "eggs" }],
      } },
    });
    expect(validateFixtures([bad]).join("\n")).toContain("write null");
  });

  it("catches duplicate ids, which would silently score one fixture twice", () => {
    expect(validateFixtures([fixture(), fixture()]).join("\n")).toContain("duplicate id");
  });
});

describe("the core parser as an extractor", () => {
  it("reads the ingredients out of a pasted caption", async () => {
    const report = await runEval(FIXTURES, coreParser);
    expect(report.scored).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.byField.item.correct).toBe(report.byField.item.total);
  });

  it("claims no title, servings or time — it only reads ingredient lines", async () => {
    const report = await runEval(FIXTURES, coreParser);
    expect(report.byField.title.correct).toBe(0);
    expect(report.byField.servings.correct).toBe(0);
    expect(report.byField.totalMinutes.correct).toBe(0);
  });

  it("surfaces the title and heading lines it mistakes for ingredients", async () => {
    const report = await runEval(FIXTURES, coreParser);
    expect(report.ingredients.spurious).toBeGreaterThan(0);
  });
});

/**
 * Refusals and sections.
 *
 * Some inputs have no recipe in them — a listing page, a Reddit thread, a caption that says
 * "comment CHICKEN and I'll DM you". For those the correct output is a refusal naming why, and a
 * plausible recipe is the worst possible answer: confident, invented, and indistinguishable from a
 * real one by anybody who did not already know the dish (decisions §46).
 */
const refusalFixture = (over: Partial<Fixture> = {}): Fixture => ({
  id: "no-recipe",
  input: { kind: "caption", text: "comment CHICKEN and I'll DM you the full recipe" },
  expected: { outcome: "refusal", because: "no-recipe-in-source" },
  ...over,
});

describe("an input with no recipe in it", () => {
  const declining = (because: RefusalReason): Extractor => () => ({ refused: { because } });

  it("counts a refusal as the right answer", async () => {
    const report = await runEval([refusalFixture()], declining("no-recipe-in-source"));
    expect(report.refusals.expected).toBe(1);
    expect(report.refusals.refused).toBe(1);
    expect(report.refusals.reasonCorrect).toBe(1);
    expect(report.overall.correct).toBe(1);
  });

  it("counts a refusal for the wrong reason as still a refusal, and says so", async () => {
    // it saved somebody from an invented recipe, and routed them to the wrong remedy
    const report = await runEval([refusalFixture()], declining("not-a-recipe-page"));
    expect(report.refusals.refused).toBe(1);
    expect(report.refusals.reasonCorrect).toBe(0);
    expect(report.overall.correct).toBe(1);
  });

  it("names an invented recipe as a confabulation rather than a low score", async () => {
    const inventing: Extractor = () => ({
      title: "Plausible Chicken Curry",
      ingredients: [
        { amount: 500, unit: "g", item: "chicken thighs" },
        { amount: 1, unit: null, item: "onion" },
      ],
    });
    const report = await runEval([refusalFixture()], inventing);
    expect(report.refusals.confabulated).toBe(1);
    expect(report.refusals.inventedIngredients).toBe(2);
    expect(report.overall.correct).toBe(0);
    expect(report.overall.total).toBe(1);
  });

  it("does not let a skip pass for a refusal", async () => {
    /*
     * regression: the trap this repo has hit three times. `null` means "not my kind of input",
     * so an extractor that handles nothing would otherwise score perfectly on every refusal
     * fixture — no result read as a pass.
     */
    const skipping: Extractor = () => null;
    const report = await runEval([refusalFixture()], skipping);
    expect(report.refusals.refused).toBe(0);
    expect(report.refusals.expected).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.overall.total).toBe(0);
  });

  it("counts declining a real recipe as a false refusal, and fails every check", async () => {
    const report = await runEval([fixture()], declining("not-a-recipe-page"));
    expect(report.refusals.falseRefusals).toBe(1);
    expect(report.overall.correct).toBe(0);
    expect(report.byField.item.correct).toBe(0);
  });

  it("says both failures out loud in the report", async () => {
    const inventing: Extractor = () => ({ ingredients: [{ amount: 1, unit: null, item: "onion" }] });
    const text = formatReport(await runEval([refusalFixture()], inventing));
    expect(text).toMatch(/CONFABULATED 1/);
  });
});

describe("sections", () => {
  const sectioned = (over: Partial<Fixture> = {}): Fixture => ({
    id: "sectioned",
    input: { kind: "caption", text: "x" },
    expected: {
      outcome: "recipe",
      recipe: {
        title: "Crunchwrap",
        servings: 4,
        totalMinutes: 30,
        ingredients: [
          { amount: 500, unit: "g", item: "ground beef", section: null },
          { amount: 0.5, unit: "cup", item: "sour cream", section: "For the sauce" },
        ],
      },
    },
    ...over,
  });

  it("scores a heading apart from the fields it has nothing to do with", async () => {
    const rightLinesWrongSections: Extractor = () => ({
      ingredients: [
        { amount: 500, unit: "g", item: "ground beef", section: null },
        { amount: 0.5, unit: "cup", item: "sour cream", section: null },
      ],
    });
    const report = await runEval([sectioned()], rightLinesWrongSections);
    // every ingredient field is right; only the heading is wrong
    expect(report.byField.amount.correct).toBe(2);
    expect(report.byField.item.correct).toBe(2);
    expect(report.sections).toEqual({ correct: 1, total: 2 });

    // and the headline is untouched by it: the same extractor with the heading right
    // scores identically, which is the whole point of reporting sections apart
    const withSections: Extractor = () => ({
      ingredients: [
        { amount: 500, unit: "g", item: "ground beef", section: null },
        { amount: 0.5, unit: "cup", item: "sour cream", section: "For the sauce" },
      ],
    });
    const better = await runEval([sectioned()], withSections);
    expect(better.overall).toEqual(report.overall);
    expect(better.sections).toEqual({ correct: 2, total: 2 });
  });

  it("forgives the typography of a heading but not the heading", async () => {
    const casing: Extractor = () => ({
      ingredients: [
        { amount: 500, unit: "g", item: "ground beef", section: null },
        { amount: 0.5, unit: "cup", item: "sour cream", section: "FOR THE SAUCE:" },
      ],
    });
    const report = await runEval([sectioned()], casing);
    expect(report.sections).toEqual({ correct: 2, total: 2 });
  });

  it("asks nothing of a fixture that states no sections", async () => {
    const report = await runEval([fixture()], coreParser);
    expect(report.sections.total).toBe(0);
  });
});

describe("a captured page snapshot", () => {
  it("insists a real capture says when it was taken", () => {
    const undated = fixture({
      id: "undated",
      input: { kind: "url", url: "https://example.com/r", text: "<div>markup</div>" },
    });
    expect(validateFixtures([undated])).toEqual([
      "undated: has a captured snapshot but no capturedAt date",
    ]);
  });

  it("is satisfied once it does", () => {
    const dated = fixture({
      id: "dated",
      input: {
        kind: "url", url: "https://example.com/r",
        text: "<div>markup</div>", capturedAt: "2026-08-15",
      },
    });
    expect(validateFixtures([dated])).toEqual([]);
  });
});
