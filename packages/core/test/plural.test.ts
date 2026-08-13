import { describe, expect, it } from "vitest";
import { formatCountable, pluralise } from "../src/format.js";

/**
 * Catalog names are singular; the display pluralises. The bug this replaces was a catalog with
 * some names stored plural and some singular, which read as "1½ lemons" beside "3 yellow onion"
 * on the same shopping list.
 */
describe("pluralise", () => {
  it("inflects the head noun and leaves the modifiers alone", () => {
    expect(pluralise("yellow onion")).toBe("yellow onions");
    expect(pluralise("flour tortilla")).toBe("flour tortillas");
    expect(pluralise("red bell pepper")).toBe("red bell peppers");
    expect(pluralise("large egg")).toBe("large eggs");
  });

  it("knows the irregulars a kitchen actually uses", () => {
    // regression: a rule-based "-o becomes -oes" turns avocado into avocadoes
    expect(pluralise("roma tomato")).toBe("roma tomatoes");
    expect(pluralise("russet potato")).toBe("russet potatoes");
    expect(pluralise("avocado")).toBe("avocados");
    expect(pluralise("bay leaf")).toBe("bay leaves");
    expect(pluralise("loaf")).toBe("loaves");
  });

  it("counts a bell pepper even though pepper the spice has no plural", () => {
    // regression: the head noun cannot settle this alone, so the two-word tail is checked first
    expect(pluralise("red bell pepper")).toBe("red bell peppers");
    expect(pluralise("green pepper")).toBe("green peppers");
    expect(pluralise("black pepper")).toBe("black pepper");
    expect(pluralise("pepper")).toBe("pepper");
  });

  it("leaves uncountables alone", () => {
    for (const name of ["bread", "sandwich bread", "rice", "arborio rice", "heavy cream", "olive oil", "garlic", "chicken", "pasta"]) {
      expect(pluralise(name), name).toBe(name);
    }
  });

  it("does not double up something already plural", () => {
    expect(pluralise("lemons")).toBe("lemons");
    expect(pluralise("garlic cloves")).toBe("garlic cloves");
    expect(pluralise("greens")).toBe("greens");
  });

  it("adds -es where -s alone would be unpronounceable", () => {
    expect(pluralise("peach")).toBe("peaches");
    expect(pluralise("squash")).toBe("squashes");
    expect(pluralise("box")).toBe("boxes");
  });

  it("turns -y into -ies only after a consonant", () => {
    expect(pluralise("berry")).toBe("berries");
    expect(pluralise("bay")).toBe("bays");
  });

  it("keeps the capitalisation it was given", () => {
    expect(pluralise("Lemon")).toBe("Lemons");
    expect(pluralise("Roma tomato")).toBe("Roma tomatoes");
  });

  it("survives nonsense without throwing", () => {
    expect(pluralise("")).toBe("");
    expect(pluralise("   ")).toBe("");
  });
});

describe("formatCountable", () => {
  it("says one of a thing in the singular", () => {
    expect(formatCountable(1, "lemon")).toBe("1 lemon");
    expect(formatCountable(1, "yellow onion")).toBe("1 yellow onion");
  });

  it("pluralises anything that is not exactly one, fractions included", () => {
    expect(formatCountable(3, "yellow onion")).toBe("3 yellow onions");
    expect(formatCountable(1.5, "lemon")).toBe("1½ lemons");
    expect(formatCountable(0.5, "lemon")).toBe("½ lemons");
    expect(formatCountable(2, "roma tomato")).toBe("2 roma tomatoes");
  });

  it("returns the bare name when there is no amount", () => {
    expect(formatCountable(null, "lemon")).toBe("lemon");
    expect(formatCountable(undefined, "lemon")).toBe("lemon");
  });
});
