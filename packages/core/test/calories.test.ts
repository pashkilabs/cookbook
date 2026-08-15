import { describe, expect, it } from "vitest";
import { createCatalog } from "../src/catalog.js";
import { estimateEnergy, formatEnergy, roundEnergy, toGrams } from "../src/calories.js";
import { parseIngredientList } from "../src/parse.js";
import type { CatalogItem } from "../src/types.js";

/**
 * Energy from the catalog.
 *
 * The arithmetic is the easy half. What these mostly test is the other half — that a partial
 * answer looks partial, because a plausible total that quietly omits the chorizo is worse than no
 * total at all.
 */
const ITEMS: CatalogItem[] = [
  {
    key: "butter", names: ["butter"], aisle: "Dairy", dimension: "weight",
    gramsPerCup: 227, packages: [], kcalPer100g: 717, energyFdcId: "173410",
  },
  {
    key: "olive-oil", names: ["olive oil"], aisle: "Pantry", dimension: "volume",
    gramsPerCup: 216, packages: [], kcalPer100g: 884, energyFdcId: "171413",
  },
  {
    key: "flour", names: ["flour"], aisle: "Pantry", dimension: "weight",
    gramsPerCup: 125, packages: [], kcalPer100g: 364, energyFdcId: "168894",
  },
  // known to the catalog, no energy figure — the common case while coverage is partial
  { key: "chorizo", names: ["chorizo"], aisle: "Meat & Seafood", dimension: "weight", packages: [] },
  // energy but no weight-per-item: "2 onions" is unanswerable
  { key: "onion", names: ["onion", "onions"], aisle: "Produce", dimension: "count", packages: [], kcalPer100g: 40 },
  // a vegetable whose name ends in a seasoning's name
  {
    key: "bell-pepper", names: ["bell pepper", "bell peppers", "red pepper"], aisle: "Produce",
    dimension: "count", packages: [], gramsEach: 119, kcalPer100g: 26,
  },
];

const catalog = createCatalog(ITEMS);
const entry = (lines: string[], scale?: number) => ({
  label: "Test",
  ingredients: parseIngredientList(lines),
  ...(scale === undefined ? {} : { scale }),
});

describe("turning an amount into grams", () => {
  it("takes a weight as it stands", () => {
    expect(toGrams(200, "g", ITEMS[0]!)).toBeCloseTo(200, 5);
  });

  it("turns a volume into grams through the item's density", () => {
    // half a cup of olive oil: 118.3 ml at 0.913 g/ml
    expect(toGrams(0.5, "cup", ITEMS[1]!)).toBeCloseTo(108, 0);
  });

  it("turns a count into grams when the catalog knows what one weighs", () => {
    const withWeight = { ...ITEMS[4]!, gramsEach: 110 };
    expect(toGrams(2, null, withWeight)).toBeCloseTo(220, 5);
  });

  it("refuses a count when it does not", () => {
    // an onion is not a gram and not a kilogram; guessing is the silent understatement this
    // module exists to avoid
    expect(toGrams(2, null, ITEMS[4]!)).toBeNull();
  });

  it("refuses a volume with no density", () => {
    const noDensity = { ...ITEMS[1]!, gramsPerCup: undefined };
    expect(toGrams(1, "cup", noDensity)).toBeNull();
  });

  it("refuses an amount that is not there", () => {
    expect(toGrams(null, "g", ITEMS[0]!)).toBeNull();
  });
});

describe("estimating a recipe", () => {
  it("adds up what it knows", () => {
    const estimate = estimateEnergy([entry(["100 g butter", "125 g flour"])], catalog);
    // 717 + 455
    expect(Math.round(estimate.kcal)).toBe(1172);
    expect(estimate.complete).toBe(true);
    expect(estimate.resolved).toBe(2);
  });

  it("respects a plan entry's multiplier, because that is more food", () => {
    const once = estimateEnergy([entry(["100 g butter"])], catalog).kcal;
    const half_again = estimateEnergy([entry(["100 g butter"], 1.5)], catalog).kcal;
    expect(half_again).toBeCloseTo(once * 1.5, 5);
  });

  it("divides by servings when the recipe says what it serves", () => {
    const estimate = estimateEnergy([entry(["100 g butter"])], catalog, { servings: 4 });
    expect(estimate.perServing).toBeCloseTo(717 / 4, 5);
  });

  it("has no per-serving figure when the recipe does not say", () => {
    expect(estimateEnergy([entry(["100 g butter"])], catalog).perServing).toBeNull();
  });
});

describe("what it does not know", () => {
  it("names an ingredient the catalog has no figure for, rather than dropping it", () => {
    const estimate = estimateEnergy([entry(["100 g butter", "200 g chorizo"])], catalog);
    expect(estimate.complete).toBe(false);
    expect(estimate.unresolved).toContain("chorizo");
    // and the total is the floor, not a claim about the dish
    expect(Math.round(estimate.kcal)).toBe(717);
  });

  it("names an ingredient it cannot measure, even when it knows the food", () => {
    // "olive oil for frying" — a real line in real recipes, and unknowable
    const estimate = estimateEnergy([entry(["olive oil for frying"])], catalog);
    expect(estimate.resolved).toBe(0);
    expect(estimate.unresolved.length).toBe(1);
  });

  it("counts salt as nothing rather than as a gap", () => {
    /*
     * `isStaple` keeps salt off the shopping list because you already have it. That is a
     * statement about buying. Salt is also genuinely no energy, so counting it as *unknown*
     * would make every recipe look incomplete for no reason.
     */
    const estimate = estimateEnergy([entry(["100 g butter", "1 tsp salt", "2 cups water"])], catalog);
    expect(estimate.complete, "salt and water are not gaps").toBe(true);
    expect(estimate.negligible).toEqual(expect.arrayContaining(["salt", "water"]));
    expect(estimate.unresolved).toEqual([]);
  });

  it("counts a pepper as food whether it is written singular or plural", () => {
    /*
     * regression: the staples rule matched any name ending in " pepper", so `1 bell pepper` was
     * declared to be nothing while `2 bell peppers` was counted at 60 — the plural was the only
     * reason a vegetable in the catalog was ever added up. The rule is about buying; this is
     * about eating.
     */
    const one = estimateEnergy([entry(["1 bell pepper"])], catalog);
    const two = estimateEnergy([entry(["2 bell peppers"])], catalog);
    expect(one.negligible, "a bell pepper is not a seasoning").toEqual([]);
    expect(one.resolved).toBe(1);
    expect(two.kcal).toBeCloseTo(one.kcal * 2, 5);
  });

  it("still counts the seasonings as nothing, including two named on one line", () => {
    const estimate = estimateEnergy(
      [entry(["1 tsp kosher salt", "black pepper", "salt and pepper", "2 cups cold water"])],
      catalog,
    );
    expect(estimate.negligible.length).toBe(4);
    expect(estimate.unresolved).toEqual([]);
  });

  it("treats a food that merely reads like a seasoning as a gap, not as nothing", () => {
    // ice cream, water chestnuts and salt cod were all swallowed by prefix matching. None is in
    // this catalog, so the right answer is "unknown" — visible, rather than silently zero.
    const estimate = estimateEnergy([entry(["200 g ice cream", "100 g water chestnuts"])], catalog);
    expect(estimate.negligible).toEqual([]);
    expect(estimate.unresolved).toEqual(["ice cream", "water chestnuts"]);
  });

  it("does not count oil as nothing, because it is not", () => {
    // the other half of the staples rule: excluded from the list, included in the food
    const estimate = estimateEnergy([entry(["2 tbsp olive oil"])], catalog);
    expect(estimate.resolved).toBe(1);
    expect(Math.round(estimate.kcal)).toBeGreaterThan(200);
  });
});

describe("saying it out loud", () => {
  it("rounds to something a recipe can honestly claim", () => {
    // 517 asserts a precision nothing here has: one onion varies twofold by size
    expect(roundEnergy(517)).toBe(520);
    expect(roundEnergy(484)).toBe(480);
  });

  it("states a complete estimate as an approximation", () => {
    const estimate = estimateEnergy([entry(["100 g butter"])], catalog);
    expect(formatEnergy(estimate)).toBe("~720");
  });

  it("states a partial estimate as a floor, and says how far from complete", () => {
    const estimate = estimateEnergy([entry(["100 g butter", "200 g chorizo"])], catalog);
    expect(formatEnergy(estimate)).toBe("at least ~720 · 1 ingredient unknown");
  });

  it("pluralises, because a total nobody can read is a total nobody reads", () => {
    // two known against two unknown: enough of the recipe accounted for to state a floor at all,
    // which is what the threshold above now requires before the wording is reachable
    const estimate = estimateEnergy(
      [entry(["100 g butter", "125 g flour", "200 g chorizo", "olive oil for frying"])],
      catalog,
    );
    expect(formatEnergy(estimate)).toMatch(/2 ingredients unknown$/);
  });

  it("says nothing rather than ~0 when what it knows rounds away", () => {
    /*
     * regression: `at least ~0` was printed as a per-serving figure for a rack of ribs where one
     * line of twelve resolved. The module declined to say `0` when it knew nothing but not when
     * it knew almost nothing, and `~0` reads as a claim about the dish.
     */
    const estimate = estimateEnergy([entry(["1 tsp butter"])], catalog, { servings: 50 });
    expect(roundEnergy(estimate.perServing!)).toBe(0);
    expect(formatEnergy(estimate, "serving")).toBe("no estimate");
  });

  it("refuses to state a floor built from a minority of the ingredients", () => {
    // eleven unknowns behind one known is not a lower bound anybody should read
    const estimate = estimateEnergy(
      [entry(["100 g butter", ...Array.from({ length: 11 }, (_, i) => `50 g mystery${i}`)])],
      catalog,
    );
    expect(estimate.resolved).toBe(1);
    expect(formatEnergy(estimate)).toBe("no estimate");
  });

  it("states the floor once half the ingredients are accounted for", () => {
    const estimate = estimateEnergy([entry(["100 g butter", "125 g flour", "200 g chorizo"])], catalog);
    expect(estimate.resolved / (estimate.resolved + estimate.unresolved.length)).toBeGreaterThanOrEqual(0.5);
    expect(formatEnergy(estimate)).toBe("at least ~1170 · 1 ingredient unknown");
  });

  it("says nothing rather than zero when it knows nothing", () => {
    // "0" is a claim about the dish; "no estimate" is a statement about us
    const estimate = estimateEnergy([entry(["200 g chorizo"])], catalog);
    expect(formatEnergy(estimate)).toBe("no estimate");
  });

  it("says the same things per serving", () => {
    const estimate = estimateEnergy([entry(["100 g butter"])], catalog, { servings: 4 });
    expect(formatEnergy(estimate, "serving")).toBe("~180");
  });
});
