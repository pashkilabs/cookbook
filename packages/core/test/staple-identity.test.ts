import { describe, expect, it } from "vitest";
import { isStaple } from "../src/index.js";

/**
 * A qualifier that changes what something IS must not inherit its staple-ness.
 *
 * regression: `isStaple` matched a staple anywhere in the name, so a bell pepper was a cupboard
 * seasoning and never reached the shopping list — while "bell peppers" did, because the plural
 * does not end in " pepper". Catalog names are stored singular, so the canonical form was the
 * one that broke.
 */
describe("what is actually in the cupboard", () => {
  it("still treats the real staples as staples", () => {
    for (const name of ["salt", "pepper", "water", "oil", "olive oil", "kosher salt",
                        "black pepper", "white pepper", "vegetable oil", "canola oil"]) {
      expect(isStaple(name), name).toBe(true);
    }
  });

  it("still sees a staple behind the words that only describe it", () => {
    for (const name of ["freshly ground black pepper", "coarse sea salt", "extra virgin olive oil",
                        "finely ground white pepper", "cold water", "boiling water"]) {
      expect(isStaple(name), name).toBe(true);
    }
  });

  // regression: every one of these was a staple, so none of them reached the shopping list
  it("does not treat a pepper you have to buy as a seasoning you already own", () => {
    for (const name of ["bell pepper", "green pepper", "red pepper", "sweet pepper",
                        "jalapeno pepper", "poblano pepper", "banana pepper"]) {
      expect(isStaple(name), name).toBe(false);
    }
  });

  it("agrees with itself about singular and plural, since the catalog stores singular", () => {
    expect(isStaple("bell pepper")).toBe(isStaple("bell peppers"));
  });

  it("knows salt pork is a meat and truffle oil is a purchase", () => {
    for (const name of ["salt pork", "truffle oil", "sesame oil", "chilli oil",
                        "garlic salt", "celery salt", "pepper jack cheese"]) {
      expect(isStaple(name), name).toBe(false);
    }
  });
});
