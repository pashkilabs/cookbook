import { describe, expect, it } from "vitest";
import { choosePackages, createCatalog } from "../src/catalog.js";
import { formatPackages } from "../src/format.js";
import {
  METRIC_PACKAGES,
  SEED_CATALOG,
  metricPackageCoverage,
  seedCatalogFor,
} from "../src/seed-catalog.js";

/**
 * Package sizes differ by market, not just in their wording — a pint is 473 ml and a metric
 * carton is 500 — so the two systems are separate sets of sizes rather than one set with two
 * labels (decisions §28).
 */
describe("package sizes per market", () => {
  it("gives a metric household sizes it can actually buy", () => {
    const us = createCatalog(seedCatalogFor("us"));
    const metric = createCatalog(seedCatalogFor("metric"));

    const usCream = us.find("heavy cream")!;
    const metricCream = metric.find("heavy cream")!;
    expect(formatPackages(choosePackages(400, usCream.packages))).toMatch(/oz|pint|quart/i);
    expect(formatPackages(choosePackages(400, metricCream.packages))).toBe("600 ml pot");
  });

  it("never mixes two markets' sizes in one purchase", () => {
    // the reason these are separate sets: choosePackages would happily suggest a pint and a
    // 500 ml carton for the same item
    for (const item of seedCatalogFor("metric")) {
      const labels = item.packages.map((size) => size.label).join(" ");
      if (METRIC_PACKAGES[item.key]) {
        expect(labels, item.key).not.toMatch(/\b(oz|lb|pint|quart|gallon|dozen)\b/);
      }
    }
  });

  it("falls back to the US sizes rather than leaving an item unbuyable", () => {
    const uncovered = metricPackageCoverage().missing[0]!;
    const item = seedCatalogFor("metric").find((entry) => entry.key === uncovered)!;
    const original = SEED_CATALOG.find((entry) => entry.key === uncovered)!;
    expect(item.packages).toEqual(original.packages);
    expect(seedCatalogFor("metric").every((entry) => entry.packages.length > 0)).toBe(true);
  });

  it("reports its own coverage rather than implying it is complete", () => {
    const coverage = metricPackageCoverage();
    expect(coverage.covered).toBeGreaterThan(30);
    expect(coverage.covered + coverage.missing.length).toBe(coverage.total);
  });

  it("leaves the US catalog untouched", () => {
    expect(seedCatalogFor("us")).toBe(SEED_CATALOG);
  });
});
