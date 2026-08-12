import { describe, expect, it } from "vitest";
import type { Extractor, Fixture } from "../eval/types.js";
import { coreParser } from "../eval/extractors/core-parser.js";
import { FIXTURES } from "../eval/fixtures/index.js";
import { formatReport } from "../eval/report.js";
import { runEval } from "../eval/runner.js";
import { amountsMatch, itemSimilarity, scoreRecipe } from "../eval/score.js";
import { validateFixtures } from "../eval/validate.js";

const fixture = (over: Partial<Fixture> = {}): Fixture => ({
  id: "test",
  input: { kind: "caption", text: "1 cup heavy cream" },
  expected: {
    title: "Cream Thing",
    servings: 2,
    totalMinutes: 10,
    ingredients: [{ amount: 1, unit: "cup", item: "heavy cream" }],
  },
  ...over,
});

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
    const score = scoreRecipe(fixture().expected, {
      ingredients: [{ amount: 1, unit: "cups", item: "heavy cream" }],
    });
    expect(score.ingredients[0]?.unitCorrect).toBe(true);

    const wrong = scoreRecipe(fixture().expected, {
      ingredients: [{ amount: 1, unit: "tbsp", item: "heavy cream" }],
    });
    expect(wrong.ingredients[0]?.unitCorrect).toBe(false);
  });

  it("treats a null unit and an explicit count as the same claim", () => {
    const expected = fixture({
      expected: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 2, unit: null, item: "eggs" }],
      },
    }).expected;
    const score = scoreRecipe(expected, {
      ingredients: [{ amount: 2, unit: "count", item: "eggs" }],
    });
    expect(score.ingredients[0]?.unitCorrect).toBe(true);
  });

  it("does not forgive a tin of diced tomatoes turning into fresh tomatoes", () => {
    // the prep word is load-bearing: two different products, so scoring must
    // use the gentle normaliser and mark this wrong
    const expected = fixture({
      expected: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 14.5, unit: "oz", item: "diced tomatoes" }],
      },
    }).expected;
    const score = scoreRecipe(expected, {
      ingredients: [{ amount: 14.5, unit: "oz", item: "tomatoes" }],
    });
    expect(score.ingredients[0]?.itemCorrect).toBe(false);
  });

  it("counts an omitted field as wrong when the source does state one", () => {
    const score = scoreRecipe(fixture().expected, { ingredients: [] });
    expect(score.fields.every((f) => !f.correct)).toBe(true);
    expect(score.correct).toBe(0);
  });

  it("reads an omitted field as null, so serialisation convention is not graded", () => {
    // schema-constrained model output routinely omits nulls, and the wrapper
    // controls field presence — grading it would grade our own adapter
    const expected = fixture({
      expected: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 1, unit: "cup", item: "heavy cream" }],
      },
    }).expected;
    const timeOf = (actual: Parameters<typeof scoreRecipe>[1]): boolean | undefined =>
      scoreRecipe(expected, actual).fields.find((f) => f.field === "totalMinutes")?.correct;

    expect(timeOf({ ingredients: [] })).toBe(true);
    expect(timeOf({ totalMinutes: null, ingredients: [] })).toBe(true);
    expect(timeOf({ totalMinutes: 30, ingredients: [] })).toBe(false);
  });

  it("fails all three checks for an ingredient it never found", () => {
    const score = scoreRecipe(fixture().expected, {
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
    const score = scoreRecipe(fixture().expected, {
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
    const expected = fixture({
      expected: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [
          { amount: 1, unit: "cup", item: "heavy cream" },
          { amount: 3, unit: "clove", item: "garlic" },
          { amount: 2, unit: "tbsp", item: "olive oil" },
        ],
      },
    }).expected;
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
    const score = scoreRecipe(fixture().expected, {
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
      expected: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 1, unit: "tbps", item: "cream" }],
      },
    });
    expect(validateFixtures([bad]).join("\n")).toContain("is not a unit");
  });

  it("nudges an alias towards its canonical spelling", () => {
    const bad = fixture({
      expected: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 1, unit: "tablespoons", item: "cream" }],
      },
    });
    expect(validateFixtures([bad]).join("\n")).toContain(`write "tbsp"`);
  });

  it("catches a count written as a unit instead of null", () => {
    const bad = fixture({
      expected: {
        title: "x",
        servings: null,
        totalMinutes: null,
        ingredients: [{ amount: 2, unit: "large", item: "eggs" }],
      },
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
