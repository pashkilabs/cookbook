import { describe, expect, it } from "vitest";
import {
  AT_A_TIME,
  LAYOUT_CHOICES,
  RECIPE_LAYOUTS,
  isRecipeLayout,
  rotation,
} from "../lib/recipe-layout";

const planned = (title: string, count: number, last: string | null = null) => ({
  id: title,
  title,
  planned: count,
  lastPlanned: last,
});

describe("the seven-at-a-time rule, which all five layouts obey", () => {
  it("never returns more than seven from the rotation", () => {
    const many = Array.from({ length: 30 }, (_, i) => planned(`R${i}`, 30 - i));
    expect(rotation(many)).toHaveLength(AT_A_TIME);
  });


});

describe("the rotation's order", () => {
  it("puts the most-planned first", () => {
    const out = rotation([planned("rare", 1), planned("often", 3), planned("sometimes", 2)]);
    expect(out.map((r) => r.title)).toEqual(["often", "sometimes", "rare"]);
  });

  it("leaves out anything never planned, rather than ranking it last", () => {
    const out = rotation([planned("never", 0), planned("once", 1)]);
    expect(out.map((r) => r.title)).toEqual(["once"]);
  });

  it("breaks a tie on most recently planned, then on title — never arbitrarily", () => {
    /*
     * This is the load-bearing one. Measured, the planning signal is flat — the top eight are
     * 3, 3, 2, 2, 2, 2, 2, 2 — so six recipes are tied and the tie-break decides the whole order.
     * An unstable sort would reorder the page between visits and destroy the spatial memory the
     * layout exists for.
     */
    const out = rotation([
      planned("older", 2, "2026-09-01"),
      planned("newest", 2, "2026-10-10"),
      planned("middle", 2, "2026-10-01"),
    ]);
    expect(out.map((r) => r.title)).toEqual(["newest", "middle", "older"]);
  });

  it("falls back to title when both the count and the date tie", () => {
    const out = rotation([planned("zebra", 2, "2026-10-01"), planned("apple", 2, "2026-10-01")]);
    expect(out.map((r) => r.title)).toEqual(["apple", "zebra"]);
  });

  it("gives the same order every time it is called, on the same input", () => {
    // a total order, so no run can disagree with another — the property that makes it stable
    const input = [
      planned("a", 2, null),
      planned("b", 2, "2026-10-01"),
      planned("c", 3, null),
      planned("d", 2, "2026-10-01"),
    ];
    const once = rotation(input).map((r) => r.title);
    expect(rotation([...input].reverse()).map((r) => r.title)).toEqual(once);
  });

  it("does not mutate what it was given", () => {
    const input = [planned("b", 1), planned("a", 3)];
    rotation(input);
    expect(input.map((r) => r.title)).toEqual(["b", "a"]);
  });
});


describe("the setting's values", () => {
  it("offers a choice for every layout the database permits, and no more", () => {
    // the two-sites problem: SQL cannot import the union, so a test compares them
    expect(LAYOUT_CHOICES.map((c) => c.value)).toEqual([...RECIPE_LAYOUTS]);
  });

  it("marks the four that are built as ready, and only the fifth as not", () => {
    expect(LAYOUT_CHOICES.filter((c) => c.ready).map((c) => c.value)).toEqual([
      "rotation", "browse", "time", "decide",
    ]);
  });

  it("gives the deferred one a reason rather than the word 'soon'", () => {
    /*
     * §71's pattern: a count a person can check, not an adjective.
     *
     * The *kind* of reason has changed since this was written. It was a ceiling — 25 of 67 named,
     * the classifier already run on 64, so waiting would not help — and it is now a schedule: the
     * same household reads 53 of its 60 mains and `/recipes` has no protein screen. The assertion
     * is unchanged because it was never about which of the two it is; it is about saying so with a
     * number.
     */
    const deferred = LAYOUT_CHOICES.filter((c) => !c.ready);
    expect(deferred.map((c) => c.value)).toEqual(["protein"]);
    for (const choice of deferred) {
      expect(choice.notYet, choice.value).toBeTruthy();
      const said = choice.notYet!({ total: 80, mains: 60, mainsNamingProtein: 53 });
      expect(said.toLowerCase(), choice.value).not.toBe("soon");
      expect(said, choice.value).toMatch(/\d/);
    }
  });

  /*
   * regression: the reason was a hard-coded string — "Only 25 of your 67 recipes name a protein,
   * so this would hide 42 of them" — shown to every household including one with three recipes and
   * one with none. By the time it was read off a screenshot all three numbers were wrong and the
   * claim had reversed: that household reads 53 of 60 mains.
   *
   * Two households, so a constant cannot pass. A single call cannot tell a computed sentence from
   * a literal that happens to contain a digit.
   */
  it("reports each household's own figures, so the reason cannot be a constant", () => {
    const protein = LAYOUT_CHOICES.find((c) => c.value === "protein")!;
    const big = protein.notYet!({ total: 80, mains: 60, mainsNamingProtein: 53 });
    const small = protein.notYet!({ total: 19, mains: 9, mainsNamingProtein: 6 });

    expect(big).toContain("53");
    expect(big).toContain("60");
    expect(small).toContain("6");
    expect(small).toContain("9");
    expect(big).not.toBe(small);

    // and none of the three numbers it used to quote at everybody
    for (const stale of ["25", "67", "42"]) {
      expect(big, `the old figure ${stale} is still being quoted`).not.toContain(stale);
      expect(small, `the old figure ${stale} is still being quoted`).not.toContain(stale);
    }
  });

  /*
   * A household with nothing to sort. The figure is not merely zero — "0 of your 0 dinners name a
   * protein" is arithmetic nobody asked for, and §83's point is that a ratio outside the range the
   * data occupies says nothing. It is a different sentence.
   */
  it("says something true to a household with no dinners in it yet", () => {
    const protein = LAYOUT_CHOICES.find((c) => c.value === "protein")!;
    const empty = protein.notYet!({ total: 0, mains: 0, mainsNamingProtein: 0 });
    expect(empty).not.toContain("0 of");
    expect(empty.toLowerCase()).toContain("not built");
  });

  it("gives a ready layout no not-yet reason, so the two states cannot blur", () => {
    for (const choice of LAYOUT_CHOICES.filter((c) => c.ready)) {
      expect(choice.notYet, choice.value).toBeUndefined();
    }
  });

  it("asks each option as a sentence about the household, never as a layout name", () => {
    for (const choice of LAYOUT_CHOICES) {
      expect(choice.label.toLowerCase(), choice.value).not.toContain("layout");
      expect(choice.label.toLowerCase(), choice.value).not.toContain("view");
      expect(choice.description.length, choice.value).toBeGreaterThan(20);
    }
  });

  it("accepts the five and refuses anything else", () => {
    for (const layout of RECIPE_LAYOUTS) expect(isRecipeLayout(layout)).toBe(true);
    // 'shelves' and 'index' were dropped; a stale value must not validate
    for (const bad of ["shelves", "index", "", "Rotation", null, 3]) expect(isRecipeLayout(bad)).toBe(false);
  });
});
