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
     * §71's pattern. "Soon" is a schedule and this is a ceiling: the classifier has run on 64 of
     * 67 recipes and named a protein for 25, so waiting changes nothing. A household told "soon"
     * about it would be told something untrue.
     */
    const deferred = LAYOUT_CHOICES.filter((c) => !c.ready);
    expect(deferred.map((c) => c.value)).toEqual(["protein"]);
    for (const choice of deferred) {
      expect(choice.notYet, choice.value).toBeTruthy();
      expect(choice.notYet!.toLowerCase(), choice.value).not.toBe("soon");
      // a count a person can check, not an adjective
      expect(choice.notYet, choice.value).toMatch(/\d/);
    }
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
