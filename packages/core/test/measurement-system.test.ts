import { describe, expect, it } from "vitest";
import { createCatalog } from "../src/catalog.js";
import { SEED_CATALOG } from "../src/seed-catalog.js";
import { parseIngredientList } from "../src/parse.js";
import { consolidate } from "../src/consolidate.js";
import { formatAsWritten, formatInSystem } from "../src/format.js";
import { formatMeasure, formatVolume, formatWeight } from "../src/format.js";
import type { ConsolidationEntry, MeasurementSystem } from "../src/types.js";

/**
 * Display follows the household (decisions §28).
 *
 * The point of these is the pair, not either column: a household reading "2.5 kg bag" above
 * "3 lb spare" is worse off than one reading either consistently.
 */
const catalog = createCatalog(SEED_CATALOG);

const recipe = (label: string, lines: string[], scale?: number): ConsolidationEntry => ({
  label,
  ingredients: parseIngredientList(lines),
  ...(scale !== undefined ? { scale } : {}),
});

/** A week with a weight, a volume, a count and a scale — one of each thing that formats. */
const WEEK: ConsolidationEntry[] = [
  recipe("Pasta", ["300 g pasta", "1 cup heavy cream", "250 g mushrooms", "2 cloves garlic"]),
  recipe("Traybake", ["500 g potatoes", "3 yellow onions", "2 tbsp olive oil"], 1.5),
  recipe("Soup", ["1 litre broth", "400 g potatoes", "½ cup heavy cream"]),
];

describe("a US household's output does not change", () => {
  /**
   * Asserted directly rather than left to the older tests passing. "Adding a parameter changed
   * nothing" is the claim, and the way to check a claim like that is to compare the two calls.
   */
  it("renders identically whether the system is omitted or stated", () => {
    for (const amount of [0, 1, 4.9, 5, 25, 100, 236, 300, 473, 946, 1000, 1500, 3785]) {
      expect(formatVolume(amount), `volume ${amount}`).toBe(formatVolume(amount, "us"));
      expect(formatWeight(amount), `weight ${amount}`).toBe(formatWeight(amount, "us"));
      expect(formatMeasure(amount, "volume")).toBe(formatMeasure(amount, "volume", "us"));
      expect(formatMeasure(amount, "weight")).toBe(formatMeasure(amount, "weight", "us"));
      expect(formatMeasure(amount, "count")).toBe(formatMeasure(amount, "count", "us"));
    }
  });

  it("consolidates identically whether the system is omitted or stated", () => {
    expect(consolidate(WEEK, catalog)).toEqual(consolidate(WEEK, catalog, { system: "us" }));
  });

  it("still says the things it said before", () => {
    const lines = consolidate(WEEK, catalog, { system: "us" });
    const cream = lines.find((line) => line.key === "heavy-cream")!;
    const potatoes = lines.find((line) => line.key === "potatoes")!;
    expect(cream.neededDisplay).toBe("1½ cup");
    expect(potatoes.neededDisplay).toBe("2½ lb");
  });
});

describe("a metric household reads metric", () => {
  const cases: Array<[number, "volume" | "weight", string, string]> = [
    // amount, dimension, us, metric
    [250, "volume", "1⅛ cup", "250 ml"],
    [500, "volume", "2⅛ cup", "500 ml"],
    [1000, "volume", "1⅛ qt", "1 l"],
    [1500, "volume", "1⅝ qt", "1.5 l"],
    [15, "volume", "1 tbsp", "15 ml"],
    [250, "weight", "9 oz", "250 g"],
    [500, "weight", "1⅛ lb", "500 g"],
    [1000, "weight", "2¼ lb", "1 kg"],
    [1500, "weight", "3⅓ lb", "1.5 kg"],
    [20, "weight", "20 g", "20 g"],
  ];

  it.each(cases)("%d %s reads %s in the US and %s in metric", (amount, dimension, us, metric) => {
    expect(formatMeasure(amount, dimension, "us")).toBe(us);
    expect(formatMeasure(amount, dimension, "metric")).toBe(metric);
  });

  it("never says half a kilo or a quarter litre", () => {
    // the threshold judgement: metric changes unit at 1000, not at whatever divides evenly
    expect(formatWeight(500, "metric")).toBe("500 g");
    expect(formatWeight(999, "metric")).toBe("999 g");
    expect(formatVolume(250, "metric")).toBe("250 ml");
    expect(formatVolume(999, "metric")).toBe("999 ml");
    for (const value of [100, 250, 500, 750, 999]) {
      expect(formatWeight(value, "metric")).not.toMatch(/kg/);
      expect(formatVolume(value, "metric")).not.toMatch(/ l$/);
    }
  });

  it("writes a decimal rather than a fraction above the threshold", () => {
    // "1.5 kg" is how it is written down; "1½ cup" is how a cup is spoken
    expect(formatWeight(1500, "metric")).toBe("1.5 kg");
    expect(formatVolume(1250, "metric")).toBe("1.3 l");
    expect(formatWeight(2000, "metric")).toBe("2 kg");
  });

  it("rounds to whole grams and millilitres below the threshold", () => {
    expect(formatWeight(247.4, "metric")).toBe("247 g");
    expect(formatVolume(236.588, "metric")).toBe("237 ml");
  });
});

describe("the whole list, both ways", () => {
  const render = (system: MeasurementSystem) =>
    consolidate(WEEK, catalog, { system }).map((line) => ({
      key: line.key,
      needed: line.neededDisplay,
      leftover: line.leftoverDisplay,
    }));

  it("agrees on what to buy and differs only in how it says it", () => {
    const us = render("us");
    const metric = render("metric");
    expect(us.map((line) => line.key)).toEqual(metric.map((line) => line.key));

    const usPotatoes = us.find((line) => line.key === "potatoes")!;
    const metricPotatoes = metric.find((line) => line.key === "potatoes")!;
    expect(usPotatoes.needed).toBe("2½ lb");
    expect(metricPotatoes.needed).toBe("1.2 kg");
  });

  it("leaves counts alone, because three onions are three onions anywhere", () => {
    const us = render("us").find((line) => line.key === "onion")!;
    const metric = render("metric").find((line) => line.key === "onion")!;
    expect(us.needed).toBe(metric.needed);
  });

  it("says what each meal takes in the household's units too", () => {
    /*
     * regression: the reported bug. `uses[].display` rendered the parse as written while the
     * need and the packages rendered in the household's system, so a metric household read
     * "600 ml pot" and "500 g" beside "Tuesday takes 1 lb" — two systems on one page, in the
     * one document that is read in a shop.
     */
    for (const line of consolidate(WEEK, catalog, { system: "metric" })) {
      for (const use of line.uses) {
        expect(use.display, `${line.key} — ${use.label}`).not.toMatch(/\b(lb|oz|cup|cups|qt|gal|tbsp|tsp|pint)\b/);
      }
    }
  });

  it("keeps a US household on US units, including for a recipe written in metric", () => {
    /*
     * The other half, asserted rather than assumed — the same guard §28's formatter work used.
     * Stating it honestly, though: this is **not** "no change at all" for US households. Before,
     * a US household holding a metric recipe read "Tuesday takes 500 g" beside "2 lb needed",
     * because the usage line rendered as written. Now it reads in US units. That is the same bug
     * mirrored, and fixing it in one direction only would have been fixing half of it.
     *
     * What is unchanged for a US household: the default, and every recipe already written in US
     * units — which is all of them in the seeded corpus.
     */
    const stated = consolidate(WEEK, catalog, { system: "us" });
    const omitted = consolidate(WEEK, catalog);
    expect(stated).toEqual(omitted);
    for (const line of stated) {
      for (const use of line.uses) {
        expect(use.display, `${line.key} — ${use.label}`).not.toMatch(/\b(g|kg|ml|l)\b/);
      }
    }
  });

  it("says the leftover in the same system as the need", () => {
    // the wart this closes: "2.5 kg bag" above "3 lb spare"
    for (const line of consolidate(WEEK, catalog, { system: "metric" })) {
      if (line.leftoverDisplay) {
        expect(line.leftoverDisplay, line.key).not.toMatch(/\b(lb|oz|cup|qt|gal|tbsp|tsp)\b/);
      }
    }
  });
});

/**
 * A recipe page in the household's units (decisions §47).
 *
 * Read-only, so it converts. The editor and the import review deliberately do not — they re-parse
 * what they display, and converting there would rewrite the stored recipe on the next save.
 */
describe("a quantity in the household's units", () => {
  const WRITTEN = [
    [1, "pint"], [2, "cup"], [0.5, "cup"], [2, "tbsp"], [1, "tsp"],
    [1.5, "lb"], [8, "oz"], [1, "stick"],
  ] as const;

  it("changes nothing at all for a US household reading a US recipe", () => {
    /*
     * regression: the reason this converts by unit rather than by round trip. `formatVolume`
     * picks its unit by magnitude, so converting unconditionally would render `1 pint cream` as
     * `2 cup cream` on the page of somebody who never asked for anything to change.
     */
    for (const [amount, unit] of WRITTEN) {
      expect(formatInSystem(amount, unit, "us"), `${amount} ${unit}`)
        .toBe(formatAsWritten(amount, unit));
    }
  });

  it("leaves a metric recipe alone for a metric household, for the same reason", () => {
    for (const [amount, unit] of [[150, "ml"], [1.5, "kg"], [500, "g"], [1, "l"]] as const) {
      expect(formatInSystem(amount, unit, "metric"), `${amount} ${unit}`)
        .toBe(formatAsWritten(amount, unit));
    }
  });

  it("converts a US recipe for a metric household", () => {
    expect(formatInSystem(1, "pint", "metric")).toBe("473 ml");
    expect(formatInSystem(1.5, "lb", "metric")).toBe("680 g");
    expect(formatInSystem(2, "cup", "metric")).toBe("473 ml");
  });

  it("converts a metric recipe for a US household, which is the same bug mirrored", () => {
    // 500 g is 1.10 lb, and saying "1 lb" would be the silent rounding this repo keeps refusing
    expect(formatInSystem(500, "g", "us")).toBe("1⅛ lb");
    expect(formatInSystem(1, "l", "us")).toBe("1⅛ qt");
  });

  it("leaves counts and cloves alone, and anything it cannot measure", () => {
    for (const system of ["us", "metric"] as const) {
      expect(formatInSystem(3, null, system)).toBe(formatAsWritten(3, null));
      expect(formatInSystem(2, "clove", system)).toBe(formatAsWritten(2, "clove"));
      expect(formatInSystem(1, "can", system)).toBe(formatAsWritten(1, "can"));
      expect(formatInSystem(null, "cup", system)).toBe(formatAsWritten(null, "cup"));
    }
  });
});
