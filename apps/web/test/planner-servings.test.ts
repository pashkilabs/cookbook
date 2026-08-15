import { describe, expect, it } from "vitest";
import {
  MAX_SCALE,
  MAX_SERVINGS,
  parseScale,
  parseServings,
  scaleForServings,
  servingsForScale,
} from "../lib/planner";

/**
 * Servings in, multiplier out.
 *
 * A person plans dinner for six; the database stores 1.5× and `packages/core` consolidates
 * against that. The conversion happens at the edge, so everything downstream is unchanged — and
 * these are the guards on the one field a person now types freely.
 */
describe("a typed servings figure", () => {
  it("takes a plain number of people", () => {
    expect(parseServings(6)).toBe(6);
    expect(parseServings("6")).toBe(6);
    expect(parseServings(" 6 ")).toBe(6);
  });

  it("refuses zero and negatives, which would ask for no food or anti-food", () => {
    expect(parseServings(0)).toBeNull();
    expect(parseServings(-2)).toBeNull();
  });

  it("refuses fractions — servings are people", () => {
    // 2.5 servings is a number a spreadsheet produces; admitting it is how 0.3333 reaches a
    // shopping list
    expect(parseServings(2.5)).toBeNull();
  });

  it("refuses what is not a number at all", () => {
    for (const value of ["", "  ", "six", "1e", null, undefined, {}, NaN, Infinity]) {
      expect(parseServings(value), String(value)).toBeNull();
    }
  });

  it("refuses an absurd figure rather than building a shopping list for it", () => {
    expect(parseServings(MAX_SERVINGS)).toBe(MAX_SERVINGS);
    expect(parseServings(MAX_SERVINGS + 1)).toBeNull();
    expect(parseServings(1_000_000)).toBeNull();
  });
});

describe("turning servings into the stored multiplier", () => {
  it("feeds six from a recipe for four at one and a half times", () => {
    expect(scaleForServings(6, 4)).toBe(1.5);
  });

  it("is one when the figure matches the recipe", () => {
    expect(scaleForServings(4, 4)).toBe(1);
  });

  it("scales down as readily as up", () => {
    expect(scaleForServings(2, 4)).toBe(0.5);
  });

  it("rounds a repeating decimal rather than storing one", () => {
    // 2 from a recipe for 3. Three places is finer than any kitchen, and the shopping list rounds
    // up to whole packages regardless.
    expect(scaleForServings(2, 3)).toBe(0.667);
  });

  it("refuses when the recipe does not say what it yields", () => {
    // "feed six" is meaningless without knowing what one batch feeds, and inventing a yield of 1
    // would quietly multiply everything by six
    expect(scaleForServings(6, null)).toBeNull();
    expect(scaleForServings(6, 0)).toBeNull();
  });

  it("allows the cap and refuses beyond it", () => {
    // the two guards meet here: `parseServings` caps the typed figure, so the multiplier cap is
    // only reachable directly. It defends itself anyway, because a function that relies on its
    // caller having checked is a function that will one day be called by something else.
    expect(scaleForServings(MAX_SERVINGS, 1)).toBe(MAX_SCALE);
    expect(scaleForServings(MAX_SERVINGS + 10, 1)).toBeNull();
  });
});

describe("reading a stored multiplier back as servings", () => {
  it("reports what the plan feeds against the recipe as it stands", () => {
    expect(servingsForScale(1.5, 4)).toBe(6);
    expect(servingsForScale(1, 4)).toBe(4);
  });

  it("never reports feeding nobody", () => {
    // a very small scale against a small recipe rounds to zero, and "0 servings" is not a thing
    // to show somebody
    expect(servingsForScale(0.1, 2)).toBe(1);
  });

  it("has nothing to say about a recipe with no yield", () => {
    expect(servingsForScale(1.5, null)).toBeNull();
  });

  it("round-trips a figure a person typed", () => {
    for (const [servings, recipeServings] of [[6, 4], [2, 4], [12, 4], [3, 3]] as const) {
      const scale = scaleForServings(servings, recipeServings)!;
      expect(servingsForScale(scale, recipeServings), `${servings} of ${recipeServings}`).toBe(servings);
    }
  });
});

describe("the multiplier a recipe without a yield still accepts", () => {
  it("takes a positive number", () => {
    expect(parseScale(1.5)).toBe(1.5);
    expect(parseScale("2")).toBe(2);
  });

  it("refuses zero, negatives and nonsense", () => {
    for (const value of [0, -1, "", "half", null, NaN, Infinity]) {
      expect(parseScale(value), String(value)).toBeNull();
    }
  });

  it("refuses an absurd multiplier", () => {
    expect(parseScale(MAX_SCALE + 1)).toBeNull();
  });
});

describe("what the shopping list receives", () => {
  /**
   * The point of the change. `packages/core` consolidates against the stored multiplier, so
   * planning a recipe for more people must move that multiplier — not merely a label.
   */
  it("hands core a multiplier that matches the servings typed", () => {
    const recipeServings = 4;
    const typed = parseServings("6")!;
    const stored = scaleForServings(typed, recipeServings)!;

    // what core will multiply every ingredient by
    expect(stored).toBe(1.5);
    // and 200g of something becomes 300g, which is what reaches the shopping list
    expect(200 * stored).toBe(300);
  });

  it("halves as readily, so cooking for two buys for two", () => {
    const stored = scaleForServings(parseServings("2")!, 4)!;
    expect(200 * stored).toBe(100);
  });
});
