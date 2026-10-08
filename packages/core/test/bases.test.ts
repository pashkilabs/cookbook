import { describe, expect, it } from "vitest";
import { createCatalog } from "../src/catalog.js";
import { recipesSharingBase, baseIngredients, linesCoveredByBase, SHARED_FOR_A_BASE } from "../src/bases.js";
import { SEED_CATALOG } from "../src/seed-catalog.js";

const catalog = createCatalog([...SEED_CATALOG]);
const recipe = (title: string, items: string[]) => ({ title, ingredients: items.map((item) => ({ item })) });

/** the real pair from the library, which is the one true positive the measurement found */
const hibachi = recipe("Hibachi Steak Bowls", [
  "mirin", "ginger paste", "butter", "carrots", "zucchinis", "mushrooms", "top sirloin steak", "rice",
]);
const friedRice = recipe("Easy Fried Rice with hibachi Steak", [
  "mirin", "ginger paste", "butter", "carrots", "zucchinis", "mushrooms", "jasmine rice", "soy sauce",
]);

describe("baseIngredients", () => {
  it("drops the thing a base is finished with", () => {
    // a shared chicken is not a shared base, which is the whole point of the exclusion
    const keys = [...baseIngredients(hibachi.ingredients, catalog).keys()];
    expect(keys).not.toContain("steak");
    expect(keys.some((k) => /rice/.test(k))).toBe(false);
    expect(keys).toContain("carrots");
  });

  it("drops staples and bare aromatics, which mean nothing in common", () => {
    const keys = [...baseIngredients(
      recipe("x", ["salt", "black pepper", "olive oil", "onion", "garlic", "mushrooms"]).ingredients,
      catalog,
    ).keys()];
    expect(keys).toEqual(["mushrooms"]);
  });

  it("keeps the recipe's own words, not the catalog's", () => {
    // the shopping-list rename lesson: a list that renames what a recipe said cannot be checked
    const found = baseIngredients(recipe("x", ["double cream", "mushrooms"]).ingredients, catalog);
    expect([...found.values()]).toContain("double cream");
  });
});

describe("recipesSharingBase", () => {
  it("finds the pair that really shares a base, and says what they share", () => {
    const [first, ...rest] = recipesSharingBase(hibachi, [friedRice], catalog);
    expect(rest).toHaveLength(0);
    expect(first?.recipe.title).toBe("Easy Fried Rice with hibachi Steak");
    expect(first!.shared.length).toBeGreaterThanOrEqual(SHARED_FOR_A_BASE);
    // the labels are the reason a cook can tell a base from a spice shelf
    expect(first!.labels).toContain("mirin");
    expect(first!.labels).toContain("mushrooms");
  });

  it("says nothing about a recipe sharing too little", () => {
    const unrelated = recipe("Peach Posset", ["double cream", "peaches", "sugar"]);
    expect(recipesSharingBase(hibachi, [unrelated], catalog)).toEqual([]);
  });

  it("never suggests the recipe itself when it is in its own candidate list", () => {
    // identity overlaps perfectly, so this must be excluded or every suggestion is the recipe
    const found = recipesSharingBase(hibachi, [hibachi, friedRice], catalog);
    expect(found.map((f) => f.recipe.title)).not.toContain("Hibachi Steak Bowls");
  });

  it("cannot exclude a rebuilt copy of itself, which is the caller's job", () => {
    /*
     * The limit of a pure function over `{ ingredients }`: it has no id to compare, so a
     * candidate rebuilt from rows looks like a different recipe that happens to match perfectly.
     * Asserted rather than left implicit, because a caller that forgets would show every recipe
     * its own name at the top of the list.
     */
    const copy = { ...hibachi, ingredients: [...hibachi.ingredients] };
    const found = recipesSharingBase(hibachi, [copy], catalog);
    expect(found.map((f) => f.recipe.title)).toContain("Hibachi Steak Bowls");
  });

  it("ranks the longer overlap first, as the more likely to be a base", () => {
    const partial = recipe("Partial", ["mirin", "ginger paste", "butter", "carrots", "mushrooms"]);
    const found = recipesSharingBase(hibachi, [partial, friedRice], catalog);
    expect(found[0]?.recipe.title).toBe("Easy Fried Rice with hibachi Steak");
  });

  it("stays silent when the planned recipe has too few base items of its own", () => {
    // not "no matches" but "nothing to match on" — a two-ingredient recipe has no base
    const thin = recipe("Toast", ["bread", "butter"]);
    expect(recipesSharingBase(thin, [friedRice], catalog)).toEqual([]);
  });

  /*
   * The limitation, asserted so it is a recorded decision and not an oversight.
   *
   * Overlap cannot tell a base from a cuisine signature — the difference is whether the items
   * are combined or merely co-present, which is a method claim (§64, third occurrence). This
   * taco/chilli pair shares five seasonings and no base, and it DOES match. The threshold cannot
   * exclude it without going silent, so the screen names what is shared and the cook judges.
   */
  it("cannot tell a spice shelf from a base, and matches one on purpose", () => {
    const tacos = recipe("Baja Fish Tacos", ["cumin", "cilantro", "avocado", "lime", "garlic powder", "cod"]);
    const chilli = recipe("White Chicken Chili", ["cumin", "cilantro", "avocado", "lime", "garlic powder", "chicken breast"]);
    const [match] = recipesSharingBase(tacos, [chilli], catalog);
    expect(match).toBeTruthy();
    expect(match!.labels).toContain("cumin");
  });
});

describe("linesCoveredByBase", () => {
  const components = [
    { name: "dressing", from: 0, to: 9, role: "sauce" },
    { name: "salad", from: 10, to: 15, role: "vegetable" },
  ];

  it("covers exactly the component's lines, looked up rather than matched by name", () => {
    // the reason a base from a known recipe works where §64's typed name did not
    expect([...linesCoveredByBase(components, "dressing", 16)]).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect([...linesCoveredByBase(components, "salad", 16)]).toEqual([10,11,12,13,14,15]);
  });

  it("is case and space insensitive, because the name was typed once and stored", () => {
    expect(linesCoveredByBase(components, "  Dressing ", 16).size).toBe(10);
  });

  it("covers nothing when the component has been renamed", () => {
    /*
     * The safe direction. `components` is a derived cache keyed on the ingredient lines, so
     * re-reading a recipe can rename its parts. A miss means the base reverts to an ordinary
     * pantry item and the lines go back on the shopping list — a household buys something it
     * may already have, which is recoverable. The opposite would be not buying what it needs.
     */
    expect(linesCoveredByBase(components, "the dressing", 16).size).toBe(0);
  });

  it("ignores a range that reaches past the list rather than clamping it", () => {
    // a partition computed against different lines; clamping would cover someone else's lines
    expect(linesCoveredByBase([{ name: "dressing", from: 0, to: 99 }], "dressing", 16).size).toBe(0);
  });

  it("covers nothing when the recipe was never split", () => {
    expect(linesCoveredByBase(null, "dressing", 16).size).toBe(0);
    expect(linesCoveredByBase([], "dressing", 16).size).toBe(0);
  });
});
