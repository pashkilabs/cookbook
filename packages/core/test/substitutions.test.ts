import { describe, expect, it } from "vitest";
import { SUBSTITUTIONS, createSubstitutions, substitutionCoverage } from "../src/substitutions.js";
import { SEED_CATALOG } from "../src/seed-catalog.js";

const table = createSubstitutions(SUBSTITUTIONS);

describe("what to use when you have run out", () => {
  it("answers the question this exists for, with no model", () => {
    const found = table.find("buttermilk");
    expect(found?.options[0]?.use).toMatch(/milk/i);
    expect(found?.options[0]?.ratio).toMatch(/1 tbsp/);
  });

  it("finds an ingredient as a recipe writes it, not only as the key spells it", () => {
    expect(table.find("1 cup self-raising flour")?.key).toBe("self-raising flour");
    expect(table.find("soured cream")?.key).toBe("sour-cream");
    expect(table.find("caster sugar")?.key).toBe("sugar");
  });

  it("does not answer greek yogurt with the entry for yogurt", () => {
    // longest-name-first, the same rule the catalog uses and for the same reason
    expect(table.find("greek yogurt")?.key).toBe("greek-yogurt");
    expect(table.find("plain yogurt")?.key).toBe("yogurt");
  });

  it("has nothing to say about something it does not cover", () => {
    expect(table.find("saffron")).toBeNull();
  });
});

describe("the caveat, which is the feature", () => {
  it("states a cost on every option, because a trade nobody named is a trap", () => {
    const missing = SUBSTITUTIONS.flatMap((entry) =>
      entry.options.filter((o) => !o.cost.trim()).map(() => entry.key),
    );
    expect(missing).toEqual([]);
  });

  it("states a ratio on every option, since 'use yogurt' is not an instruction", () => {
    const missing = SUBSTITUTIONS.flatMap((entry) =>
      entry.options.filter((o) => !o.ratio.trim()).map(() => entry.key),
    );
    expect(missing).toEqual([]);
  });

  it("says where a substitution is wrong, not merely that it exists", () => {
    // the case this rule was written for: fine in a sauce, wrong in a bake
    const sour = table.find("sour cream")!;
    expect(sour.options[0]?.notFor).toMatch(/baking/i);
  });

  it("warns that butter for oil is not one for one", () => {
    const butter = table.find("unsalted butter")!;
    expect(butter.options[0]?.ratio).not.toMatch(/one for one/i);
    expect(butter.options[0]?.cost).toMatch(/water/i);
  });
});

describe("coverage against the catalog", () => {
  it("reports the gap rather than hiding it (§50)", () => {
    const coverage = substitutionCoverage(SEED_CATALOG);
    expect(coverage.total).toBe(SUBSTITUTIONS.length);
    expect(coverage.keyed + coverage.bare.length).toBe(coverage.total);
    // the point of the report: bare names are candidates for catalog expansion
    expect(coverage.bare.length).toBeGreaterThan(0);
  });

  it("keys to the catalog wherever the catalog has the ingredient", () => {
    const keys = new Set(SEED_CATALOG.map((i) => i.key));
    for (const shouldBeKeyed of ["buttermilk", "sour-cream", "butter", "eggs", "honey"]) {
      expect(keys.has(shouldBeKeyed), shouldBeKeyed).toBe(true);
      expect(SUBSTITUTIONS.some((e) => e.key === shouldBeKeyed), shouldBeKeyed).toBe(true);
    }
  });

  it("has no duplicate keys", () => {
    const seen = SUBSTITUTIONS.map((e) => e.key);
    expect(seen.length).toBe(new Set(seen).size);
  });
});
