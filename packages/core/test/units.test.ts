import { describe, expect, it } from "vitest";
import { canonicalUnit, toBaseMeasure, UNITS } from "../src/units.js";
import { createCatalog } from "../src/catalog.js";
import { SEED_CATALOG } from "../src/seed-catalog.js";
import { formatMeasure, formatVolume, formatWeight } from "../src/format.js";
import { formatQuantity, isStaple, normaliseName, lightName } from "../src/text.js";

const catalog = createCatalog(SEED_CATALOG);

describe("canonicalUnit", () => {
  it("resolves spellings and abbreviations", () => {
    expect(canonicalUnit("Tablespoons")).toBe("tbsp");
    expect(canonicalUnit("OZ.")).toBe("oz");
    expect(canonicalUnit("cloves")).toBe("clove");
    // the written word survives: a jar stays a jar, because "2 jars" is what gets displayed
    // and what a per-ingredient size is keyed on. Flattening every container to "can" lost both.
    expect(canonicalUnit("jars")).toBe("jar");
    expect(canonicalUnit("packages")).toBe("package");
    expect(canonicalUnit("pkg")).toBe("package");
    expect(canonicalUnit("large")).toBe("count");
  });

  it("returns null for words that are not units, so they stay in the item name", () => {
    expect(canonicalUnit("ripe")).toBeNull();
    expect(canonicalUnit("chopped")).toBeNull();
    expect(canonicalUnit("")).toBeNull();
    expect(canonicalUnit(null)).toBeNull();
  });
});

describe("toBaseMeasure", () => {
  it("converts volume to millilitres and weight to grams", () => {
    expect(toBaseMeasure(1, "cup")).toMatchObject({ dimension: "volume" });
    expect(toBaseMeasure(1, "cup")!.amount).toBeCloseTo(236.588, 2);
    expect(toBaseMeasure(1, "lb")!.amount).toBeCloseTo(453.592, 2);
  });

  it("bridges volume to weight for items sold by weight", () => {
    // 1 cup flour is 125 g, not 236 ml — flour is bought in pounds
    const flour = catalog.find("all purpose flour");
    const measure = toBaseMeasure(1, "cup", flour);
    expect(measure).toMatchObject({ dimension: "weight" });
    expect(measure!.amount).toBeCloseTo(125, 0);
  });

  it("turns a tin into its contents", () => {
    const beans = catalog.find("black beans");
    const measure = toBaseMeasure(2, "can", beans);
    expect(measure).toMatchObject({ dimension: "weight" });
    expect(measure!.amount).toBeCloseTo(850, 0);
  });

  it("treats a missing unit as a count of whole things", () => {
    expect(toBaseMeasure(3, null)).toMatchObject({ amount: 3, dimension: "count" });
  });

  it("returns null when there is no quantity", () => {
    expect(toBaseMeasure(null, "cup")).toBeNull();
    expect(toBaseMeasure(Number.NaN, "cup")).toBeNull();
  });
});

describe("formatting", () => {
  it("writes quantities the way a cook would say them", () => {
    expect(formatQuantity(0.5)).toBe("½");
    expect(formatQuantity(1.5)).toBe("1½");
    expect(formatQuantity(0.25)).toBe("¼");
    expect(formatQuantity(2)).toBe("2");
    expect(formatQuantity(1 / 3)).toBe("⅓");
  });

  it("rounds up rather than printing 7.99 tbsp", () => {
    expect(formatQuantity(0.98)).toBe("1");
    expect(formatQuantity(2.96)).toBe("3");
  });

  it("picks a sensible unit for the size of the measure", () => {
    expect(formatVolume(118)).toBe("½ cup");
    expect(formatVolume(473)).toBe("2 cup");
    expect(formatVolume(946)).toBe("1 qt");
    expect(formatVolume(15)).toBe("1 tbsp");
    expect(formatWeight(454)).toBe("1 lb");
    expect(formatWeight(28)).toBe("1 oz");
    expect(formatWeight(10)).toBe("10 g");
  });

  it("pluralises countable dimensions", () => {
    expect(formatMeasure(1, "clove")).toBe("1 clove");
    expect(formatMeasure(7, "clove")).toBe("7 cloves");
    expect(formatMeasure(1, "bunch")).toBe("1 bunch");
  });
});

describe("name normalisation", () => {
  it("strips preparation words for grouping", () => {
    expect(normaliseName("1 large onion, finely diced")).toBe("1 onion");
    expect(normaliseName("Heavy Whipping Cream (cold)")).toBe("heavy whipping cream");
  });

  it("keeps load-bearing words in the gentle form", () => {
    // "diced" distinguishes a tin of tomatoes from fresh ones
    expect(lightName("diced tomatoes")).toBe("diced tomatoes");
    expect(normaliseName("diced tomatoes")).toBe("tomatoes");
  });

  it("recognises cupboard staples", () => {
    expect(isStaple("salt")).toBe(true);
    expect(isStaple("kosher salt")).toBe(true);
    expect(isStaple("salt and pepper")).toBe(true);
    expect(isStaple("water")).toBe(true);
    expect(isStaple("heavy cream")).toBe(false);
    expect(isStaple("salted butter")).toBe(false);
  });
});

describe("unit table", () => {
  it("has a base multiplier for every unit", () => {
    for (const [key, def] of Object.entries(UNITS)) {
      expect(def.toBase, key).toBeGreaterThan(0);
    }
  });
});

describe("containers resolve per ingredient, never per word", () => {
  const yeast = {
    key: "dry-yeast", names: ["dry yeast"], aisle: "Baking", dimension: "weight" as const,
    packages: [], containers: { package: 7, packet: 7 },
  };
  const cakeMix = {
    key: "cake-mix", names: ["cake mix"], aisle: "Baking", dimension: "weight" as const, packages: [],
  };

  it("resolves a packet of yeast to 7 g, which is standard across brands", () => {
    expect(toBaseMeasure(2, "package", yeast)).toEqual({ amount: 14, dimension: "weight" });
    expect(toBaseMeasure(1, "packet", yeast)).toEqual({ amount: 7, dimension: "weight" });
  });

  it("leaves a box of cake mix as a count of boxes, because no size is standard", () => {
    // a box is 13.25 oz for one brand and 15.25 for another, and cake mixes have gone
    // 18 → 16 → 15 oz over time. "1 box" is buyable; a guessed weight is confidently wrong
    // on exactly the old family recipes this exists to preserve.
    expect(toBaseMeasure(1, "box", cakeMix)).toEqual({ amount: 1, dimension: "can" });
  });

  it("does not let one ingredient's container size leak to another's same word", () => {
    // "package" is 7 g for yeast and nothing knowable for cake mix — same word, different answer
    expect(toBaseMeasure(1, "package", cakeMix)).toEqual({ amount: 1, dimension: "can" });
    expect(toBaseMeasure(1, "package", yeast)).toEqual({ amount: 7, dimension: "weight" });
  });
});

describe("tablespoon abbreviations", () => {
  // regression: "3 tb fresh dill" from a real Instagram caption parsed with unit null and
  // "tb fresh dill" as the item — `tbs` was registered and `tb` was not, so every `tb` line
  // in that caption lost its unit and swept the abbreviation into the ingredient name
  it("reads tb, tbs, tbl and tablespoon as the same unit", () => {
    for (const written of ["tb", "tbs", "tbsps", "tbl", "tablespoon", "tablespoons"]) {
      expect(canonicalUnit(written), written).toBe("tbsp");
    }
  });

  it("still keeps T a tablespoon and t a teaspoon", () => {
    expect(canonicalUnit("T")).toBe("tbsp");
    expect(canonicalUnit("t")).toBe("tsp");
  });
});
