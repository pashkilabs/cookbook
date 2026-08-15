import { describe, expect, it } from "vitest";
import { andList, energyForRecipe } from "../lib/energy";

/**
 * What the recipe screen puts above the ingredient list.
 *
 * The arithmetic and every judgement about whether a figure may be stated belong to
 * `packages/core`; these cover the seam — that the plan entry's multiplier reaches the estimate,
 * and that a refusal from core stays a refusal here rather than becoming a zero on a screen.
 */
const CATALOG = [
  {
    id: "1", key: "butter", canonical_name: "butter", aliases: [], aisle: "Dairy",
    dimension: "weight", grams_per_cup: 227, can_size: null, grams_each: null,
    kcal_per_100g: 717, energy_fdc_id: "173410",
  },
  {
    id: "2", key: "flour", canonical_name: "all purpose flour", aliases: ["flour"], aisle: "Pantry",
    dimension: "weight", grams_per_cup: 125, can_size: null, grams_each: null,
    kcal_per_100g: 364, energy_fdc_id: "168894",
  },
  {
    id: "3", key: "chorizo", canonical_name: "chorizo", aliases: [], aisle: "Meat & Seafood",
    dimension: "weight", grams_per_cup: null, can_size: null, grams_each: null,
    kcal_per_100g: null, energy_fdc_id: null,
  },
];

const line = (amount: number | null, unit: string | null, item: string) => ({
  amount, unit, item_text: item, note: null,
});

describe("the figure above the ingredient list", () => {
  it("reads out what the recipe adds up to, per serving and in total", () => {
    const energy = energyForRecipe(
      [line(100, "g", "butter"), line(125, "g", "flour")],
      CATALOG,
      { servings: 4, scale: 1 },
    );
    expect(energy?.stated).toBe(true);
    expect(energy?.isFloor).toBe(false);
    // 717 + 455
    expect(energy?.total).toBe(1170);
    expect(energy?.perServing).toBe(290);
  });

  it("keeps a serving the same size when the meal is planned for more people", () => {
    /*
     * The point of taking the plan entry's scale. Cooking half again as much is half again as
     * much food and half again as many mouths, so the multiplier cancels per serving and
     * survives in the total — a roast planned for nine is not more fattening per plate.
     */
    const once = energyForRecipe([line(100, "g", "butter")], CATALOG, { servings: 4, scale: 1 });
    const half_again = energyForRecipe([line(100, "g", "butter")], CATALOG, { servings: 4, scale: 1.5 });
    expect(half_again?.perServing).toBe(once?.perServing);
    expect(half_again?.total).toBe(roundToTen((once?.total ?? 0) * 1.5));
  });

  it("names what it could not price, rather than leaving it out of the sum", () => {
    const energy = energyForRecipe(
      [line(100, "g", "butter"), line(125, "g", "flour"), line(200, "g", "chorizo")],
      CATALOG,
      { servings: 4, scale: 1 },
    );
    expect(energy?.isFloor).toBe(true);
    expect(energy?.unknown).toEqual(["chorizo"]);
  });

  it("states nothing at all when too little of the recipe is known", () => {
    // core refuses a floor built from a minority of the ingredients; that refusal has to survive
    // the trip to the screen rather than arriving as "~0"
    const energy = energyForRecipe(
      [line(100, "g", "butter"), line(200, "g", "chorizo"), line(1, null, "guanciale"), line(2, null, "leeks")],
      CATALOG,
      { servings: 4, scale: 1 },
    );
    expect(energy?.stated).toBe(false);
    expect(energy?.perServing).toBeNull();
  });

  it("has nothing to show for a recipe with no ingredients recorded", () => {
    expect(energyForRecipe([], CATALOG, { servings: 4, scale: 1 })).toBeNull();
  });

  it("gives a total but no per-serving figure when the recipe does not say what it yields", () => {
    const energy = energyForRecipe([line(100, "g", "butter")], CATALOG, { servings: null, scale: 1 });
    expect(energy?.total).toBe(720);
    expect(energy?.perServing).toBeNull();
  });
});

describe("naming what is missing", () => {
  it("reads as a person would say it", () => {
    expect(andList(["a"])).toBe("a");
    expect(andList(["a", "b"])).toBe("a and b");
    expect(andList(["a", "b", "c"])).toBe("a, b and c");
  });

  it("stops before the list becomes the whole screen", () => {
    expect(andList(["a", "b", "c", "d", "e"])).toBe("a, b and c and 2 more");
  });
});

const roundToTen = (n: number) => Math.round(n / 10) * 10;
