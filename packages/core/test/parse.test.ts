import { describe, expect, it } from "vitest";
import { parseIngredientLine, parseIngredientList } from "../src/parse.js";

/** Lines lifted from real recipe sites and social captions. */
describe("parseIngredientLine", () => {
  it("reads a plain quantity, unit and item", () => {
    expect(parseIngredientLine("2 tablespoons olive oil")).toMatchObject({
      amount: 2, unit: "tbsp", item: "olive oil",
    });
  });

  it("reads vulgar fractions, alone and mixed", () => {
    expect(parseIngredientLine("½ cup sugar")).toMatchObject({ amount: 0.5, unit: "cup" });
    expect(parseIngredientLine("1 ½ cups heavy cream")).toMatchObject({ amount: 1.5, unit: "cup" });
    expect(parseIngredientLine("1½ cups heavy cream")).toMatchObject({ amount: 1.5, unit: "cup" });
  });

  it("reads written fractions", () => {
    expect(parseIngredientLine("1 1/2 cups flour")).toMatchObject({ amount: 1.5 });
    expect(parseIngredientLine("3/4 tsp salt")).toMatchObject({ amount: 0.75 });
    expect(parseIngredientLine("1-1/2 lbs chicken breast")).toMatchObject({ amount: 1.5, unit: "lb" });
  });

  it("takes the upper bound of a range so the shopping list doesn't come up short", () => {
    expect(parseIngredientLine("2 to 3 cloves garlic, minced")).toMatchObject({
      amount: 3, unit: "clove", item: "garlic", note: "minced",
    });
    expect(parseIngredientLine("1-2 lemons")).toMatchObject({ amount: 2 });
  });

  it("converts a sized tin into its real measure", () => {
    expect(parseIngredientLine("1 (14.5 ounce) can diced tomatoes, drained")).toMatchObject({
      amount: 14.5, unit: "oz", item: "diced tomatoes", note: "drained",
    });
  });

  it("handles the size printed after the container word", () => {
    expect(parseIngredientLine("1 can (13.5 oz) coconut milk")).toMatchObject({
      amount: 13.5, unit: "oz", item: "coconut milk",
    });
  });

  it("multiplies through when several tins are called for", () => {
    expect(parseIngredientLine("2 (15 oz) cans black beans, rinsed")).toMatchObject({
      amount: 30, unit: "oz", item: "black beans",
    });
  });

  it("keeps a bare tin as a count when no size is given", () => {
    expect(parseIngredientLine("1 can black beans")).toMatchObject({ amount: 1, unit: "can" });
  });

  it("treats size words as a count of whole things", () => {
    expect(parseIngredientLine("1 large yellow onion, finely diced")).toMatchObject({
      amount: 1, unit: null, item: "yellow onion", note: "finely diced",
    });
    expect(parseIngredientLine("4 boneless skinless chicken thighs")).toMatchObject({ amount: 4 });
  });

  it("reads citrus phrased as juice or zest", () => {
    expect(parseIngredientLine("Juice of 1 lemon")).toMatchObject({ amount: 1, item: "lemon", note: "juice" });
    expect(parseIngredientLine("Zest and juice of 2 limes")).toMatchObject({ amount: 2, item: "limes" });
    expect(parseIngredientLine("Juice of a lemon")).toMatchObject({ amount: 1, item: "lemon" });
  });

  it("strips checkbox and bullet characters used by recipe plugins", () => {
    expect(parseIngredientLine("▢ 1 cup shredded mozzarella cheese")).toMatchObject({
      amount: 1, unit: "cup", item: "shredded mozzarella cheese",
    });
    expect(parseIngredientLine("• 2 tbsp olive oil")).toMatchObject({ amount: 2, unit: "tbsp" });
    expect(parseIngredientLine("- 1 lb pasta")).toMatchObject({ amount: 1, unit: "lb" });
  });

  it("moves trailing qualifiers into the note", () => {
    expect(parseIngredientLine("3 tablespoons unsalted butter, divided")).toMatchObject({
      item: "unsalted butter", note: "divided",
    });
    expect(parseIngredientLine("2 tbsp olive oil, plus more for drizzling")).toMatchObject({
      item: "olive oil",
    });
    expect(parseIngredientLine("Salt and pepper to taste")).toMatchObject({
      amount: null, item: "salt and pepper", note: "to taste",
    });
  });

  it("pulls a trailing parenthetical into the note", () => {
    expect(parseIngredientLine("1 bunch fresh cilantro (optional)")).toMatchObject({
      item: "fresh cilantro", note: "optional",
    });
  });

  it("strips html from lines scraped out of a page", () => {
    expect(parseIngredientLine("<li>2 <span>cups</span> milk</li>")).toMatchObject({
      amount: 2, unit: "cup", item: "milk",
    });
    expect(parseIngredientLine("1 &frac12; cups flour")).toMatchObject({ amount: 1.5 });
  });

  it("normalises unit spellings", () => {
    for (const [written, expected] of [
      ["1 T butter", "tbsp"], ["1 tbs butter", "tbsp"], ["1 Tablespoon butter", "tbsp"],
      ["2 c milk", "cup"], ["2 lbs beef", "lb"], ["500 grams beef", "g"],
      ["1 stick butter", "stick"], ["2 qt stock", "quart"],
    ] as const) {
      expect(parseIngredientLine(written)?.unit, written).toBe(expected);
    }
  });

  it("keeps the original text for display", () => {
    expect(parseIngredientLine("2 tbsp olive oil")?.raw).toBe("2 tbsp olive oil");
  });

  it("rejects things that are not ingredients", () => {
    expect(parseIngredientLine("")).toBeNull();
    expect(parseIngredientLine("   ")).toBeNull();
    expect(parseIngredientLine("123")).toBeNull();
    expect(parseIngredientLine("x".repeat(250))).toBeNull();
  });

  it("does not swallow a leading word that only looks like a unit", () => {
    // "ripe" is not a measure, so it stays part of the item
    expect(parseIngredientLine("2 ripe avocados")).toMatchObject({ item: "ripe avocados" });
  });
});

describe("parseIngredientList", () => {
  it("drops unparseable lines rather than failing the whole list", () => {
    const result = parseIngredientList([
      "For the sauce:", "", "1 cup cream", "2 cloves garlic", "   ",
    ]);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.item)).toEqual(["for the sauce", "cream", "garlic"]);
  });
});
