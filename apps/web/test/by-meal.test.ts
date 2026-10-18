import { describe, expect, it } from "vitest";
import type { ShoppingLine } from "@pashki/core";
import { byMeal } from "../lib/by-meal";

const line = (
  key: string,
  label: string,
  uses: Array<{ label: string; groupKey?: string; display: string }>,
  extra: Partial<ShoppingLine> = {},
): ShoppingLine =>
  ({
    key,
    label,
    aisle: "Dairy",
    dimension: "volume",
    needed: 100,
    neededDisplay: "1 pint",
    packages: null,
    packagesDisplay: "1 pint",
    capacity: 473,
    leftover: 0,
    leftoverDisplay: null,
    uses: uses.map((use) => ({ ...use, amount: 1 })),
    inPantry: false,
    pantryDeducted: false,
    otherDimensions: [],
    ...extra,
  }) as ShoppingLine;

describe("the shopping list read by meal instead of by aisle", () => {
  it("never carries the package decision onto a meal, because the pint belongs to the week", () => {
    // regression-shaped: "buy 1 pint" under Tuesday AND under Friday reads as two pints, which
    // is the exact waste this product exists to remove
    const groups = byMeal([
      {
        lines: [
          line("cream", "heavy cream", [
            { label: "Tuscan Pasta", groupKey: "2026-10-20", display: "½ cup" },
            { label: "Potato Leek Soup", groupKey: "2026-10-23", display: "1 cup" },
          ]),
        ],
      },
    ]);
    expect(groups.map((group) => group.meal)).toEqual(["Tuscan Pasta", "Potato Leek Soup"]);
    expect(groups.flatMap((group) => group.items.map((item) => item.portion))).toEqual(["½ cup", "1 cup"]);
    const serialised = JSON.stringify(groups);
    expect(serialised).not.toContain("1 pint");
    expect(serialised).not.toContain("packagesDisplay");
  });

  it("keeps the consolidated key on every portion, so one tick crosses it off everywhere", () => {
    const groups = byMeal([
      {
        lines: [
          line("cream", "heavy cream", [
            { label: "A", groupKey: "2026-10-20", display: "½ cup" },
            { label: "B", groupKey: "2026-10-23", display: "1 cup" },
          ]),
        ],
      },
    ]);
    expect(groups.flatMap((group) => group.items.map((item) => item.key))).toEqual(["cream", "cream"]);
  });

  it("treats the same recipe on two days as two meals", () => {
    const groups = byMeal([
      {
        lines: [
          line("rice", "rice", [
            { label: "Fried Rice", groupKey: "2026-10-20", display: "2 cups" },
            { label: "Fried Rice", groupKey: "2026-10-24", display: "2 cups" },
          ]),
        ],
      },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.date)).toEqual(["2026-10-20", "2026-10-24"]);
  });

  it("treats two recipes on one day as two meals, named in a stable order", () => {
    /*
     * Alphabetical within a day, not the order the lines were encountered.
     *
     * `plan_entries.slot` exists but a shopping list consolidates across slots by design, so
     * nothing here says which of two dinners
     * on one Tuesday comes first, and both orders are arbitrary. Encounter order is *aisle*
     * order, which is arbitrary with respect to meals and shuffles when a catalog aisle changes;
     * alphabetical is arbitrary and stable. This test first asserted encounter order, which was
     * my assumption rather than a decision, and the code's choice is the better one.
     */
    const groups = byMeal([
      {
        lines: [
          line("oil", "olive oil", [
            { label: "Soup", groupKey: "2026-10-20", display: "1 tbsp" },
            { label: "Salad", groupKey: "2026-10-20", display: "2 tbsp" },
          ]),
        ],
      },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.meal)).toEqual(["Salad", "Soup"]);
    expect(groups.map((group) => group.items[0]!.portion)).toEqual(["2 tbsp", "1 tbsp"]);
  });

  it("gathers every ingredient a meal needs, across aisles", () => {
    const groups = byMeal([
      { lines: [line("cream", "cream", [{ label: "Pasta", groupKey: "2026-10-20", display: "½ cup" }])] },
      { lines: [line("leek", "leeks", [{ label: "Pasta", groupKey: "2026-10-20", display: "2" }])] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((item) => item.label)).toEqual(["cream", "leeks"]);
  });

  it("says some for an ingredient the recipe gave no amount for, rather than nothing", () => {
    const groups = byMeal([
      { lines: [line("salt", "salt", [{ label: "Pasta", groupKey: "2026-10-20", display: "" }])] },
    ]);
    expect(groups[0]!.items[0]!.portion).toBe("some");
  });

  it("orders meals by date and puts undated ones last", () => {
    const groups = byMeal([
      {
        lines: [
          line("x", "x", [
            { label: "Friday thing", groupKey: "2026-10-23", display: "1" },
            { label: "No date", display: "1" },
            { label: "Monday thing", groupKey: "2026-10-19", display: "1" },
          ]),
        ],
      },
    ]);
    expect(groups.map((group) => group.meal)).toEqual(["Monday thing", "Friday thing", "No date"]);
  });
});
