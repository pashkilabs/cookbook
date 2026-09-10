import { describe, expect, it } from "vitest";
import { COMPONENT_LABELS, scoreComponents, AGREEMENT } from "../eval/fixtures/components.js";

const truth = [
  { name: "sauce", from: 0, to: 3, role: "sauce" as const },
  { name: "chicken", from: 4, to: 9, role: "protein" as const },
];

describe("scoring a component proposal", () => {
  it("separates a decline from a wrong answer — they want opposite corrections", () => {
    expect(scoreComponents(truth, null).verdict).toBe("declined");
    expect(scoreComponents(truth, [{ from: 0, to: 9, role: "protein" }]).verdict).toBe("wrong");
  });

  it("calls a partition right only when every component is found and none invented", () => {
    const exact = scoreComponents(truth, [
      { from: 0, to: 3, role: "sauce" },
      { from: 4, to: 9, role: "protein" },
    ]);
    expect(exact.verdict).toBe("right");
    expect(exact.matched).toBe(2);
    expect(exact.rolesRight).toBe(2);
  });

  /*
   * One ingredient either side of a boundary is not a different reading of the recipe, so the
   * match tolerates it — but anything looser stops meaning "the same component".
   */
  it("forgives a boundary off by one, and refuses a split that is not the same shape", () => {
    expect(scoreComponents(truth, [
      { from: 0, to: 4, role: "sauce" },
      { from: 5, to: 9, role: "protein" },
    ]).matched).toBe(2);
    expect(scoreComponents(truth, [
      { from: 0, to: 1, role: "sauce" },
      { from: 2, to: 9, role: "protein" },
    ]).verdict).toBe("wrong");
  });

  // the failure that matters: structure invented in a recipe that has none
  it("marks an invented split wrong even though it covers everything", () => {
    const single = [{ name: "the pan", from: 0, to: 9, role: "protein" as const }];
    const score = scoreComponents(single, [
      { from: 0, to: 4, role: "protein" },
      { from: 5, to: 9, role: "sauce" },
    ]);
    expect(score.verdict).toBe("wrong");
    expect(score.countProposed).toBe(2);
    expect(score.countExpected).toBe(1);
  });

  it("scores the role apart from the boundary, so a right split with a wrong role is visible", () => {
    const score = scoreComponents(truth, [
      { from: 0, to: 3, role: "vegetable" },
      { from: 4, to: 9, role: "protein" },
    ]);
    expect(score.matched).toBe(2);
    expect(score.rolesRight).toBe(1);
  });

  it("never counts one proposal against two labelled components", () => {
    const score = scoreComponents(truth, [{ from: 0, to: 9, role: "sauce" }]);
    expect(score.matched).toBeLessThanOrEqual(1);
  });
});

describe("the labelled set", () => {
  it("has thirty recipes and covers every ingredient exactly once", () => {
    expect(COMPONENT_LABELS).toHaveLength(30);
    for (const recipe of COMPONENT_LABELS) {
      const seen = new Set<number>();
      for (const c of recipe.components) {
        for (let i = c.from; i <= c.to; i += 1) {
          expect(seen.has(i), `${recipe.title} position ${i}`).toBe(false);
          seen.add(i);
        }
      }
      expect(seen.size, recipe.title).toBe(recipe.ingredientCount);
    }
  });

  /*
   * A set of only complex recipes could never catch the failure that matters — a component
   * invented where there is none. A third of the set is deliberately single-component.
   */
  it("holds enough single-component recipes to catch invented structure", () => {
    const singles = COMPONENT_LABELS.filter((r) => r.components.length === 1);
    expect(singles.length).toBeGreaterThanOrEqual(8);
  });

  it("spans one to five components, so the scorer is exercised across the range", () => {
    const counts = new Set(COMPONENT_LABELS.map((r) => r.components.length));
    expect([...counts].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("agrees at a threshold that is a judgement, and states it", () => {
    expect(AGREEMENT).toBe(0.7);
  });
});
