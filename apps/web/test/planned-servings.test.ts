import { describe, expect, it } from "vitest";
import { scaleIngredientAmounts } from "../lib/planner";

/**
 * Cooking from a planned meal.
 *
 * Stephen planned a recipe for nine, opened it to cook, and saw the original amounts. The
 * shopping list had scaled — its test asserts a 1.5× recipe buys 1.5× — so the multiplier was
 * being stored and applied to *what you buy* and to nothing you *cook from*.
 *
 * regression: the detail screen had no concept of a plan entry at all.
 */
describe("ingredient amounts for a planned meal", () => {
  const lines = [
    { id: "a", amount: 200, unit: "g", item_text: "flour" },
    { id: "b", amount: 2, unit: null, item_text: "eggs" },
    { id: "c", amount: null, unit: null, item_text: "salt to taste" },
  ];

  it("scales every stated amount", () => {
    const scaled = scaleIngredientAmounts(lines, 1.5);
    expect(scaled.map((l) => l.amount)).toEqual([300, 3, null]);
  });

  it("leaves an unstated amount unstated rather than inventing one", () => {
    // "salt to taste" is not 1.5 of anything
    expect(scaleIngredientAmounts(lines, 2)[2]?.amount).toBeNull();
  });

  it("is a no-op at one, so an unplanned recipe is untouched", () => {
    expect(scaleIngredientAmounts(lines, 1)).toEqual(lines);
  });

  it("keeps everything else about the line", () => {
    const [first] = scaleIngredientAmounts(lines, 2);
    expect(first).toMatchObject({ id: "a", unit: "g", item_text: "flour", amount: 400 });
  });

  it("refuses a scale that is not a usable multiplier", () => {
    // a stale or hand-edited URL must not silently halve somebody's dinner
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(scaleIngredientAmounts(lines, bad), String(bad)).toEqual(lines);
    }
  });
});
