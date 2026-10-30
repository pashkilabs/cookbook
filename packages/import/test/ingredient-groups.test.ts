import { describe, expect, it } from "vitest";
import { ingredientGroups, sectionedIngredients } from "../src/ingredient-groups.js";

/*
 * Markup shaped like the two reported pages, trimmed to what the reader actually looks at.
 * Written from the real cards rather than invented: a fixture written from the output it is meant
 * to judge measures nothing.
 */
const card = (groups: { heading: string; items: string[] }[]): string =>
  groups
    .map(
      (g) =>
        `<div class="wprm-recipe-ingredient-group"><h4 class="wprm-recipe-group-name">${g.heading}</h4><ul>` +
        g.items.map((i) => `<li class="wprm-recipe-ingredient">${i}</li>`).join("") +
        `</ul></div>`,
    )
    .join("");

const SPAGHETTIOS = card([
  { heading: "Sauce", items: ["2 cups beef broth", "1/2 cup half and half"] },
  { heading: "Mini Meatballs", items: ["3/4 lb. ground beef", "1 egg"] },
  { heading: "Pasta, etc.", items: ["1 tablespoon butter"] },
]);
const SPAGHETTIOS_LINES = [
  "2 cups beef broth",
  "1/2 cup half and half",
  "3/4 lb. ground beef",
  "1 egg",
  "1 tablespoon butter",
];

describe("reading a card's ingredient groups", () => {
  it("reads the headings in page order with the size of each run", () => {
    expect(ingredientGroups(SPAGHETTIOS)).toEqual([
      { heading: "Sauce", items: 2 },
      { heading: "Mini Meatballs", items: 2 },
      { heading: "Pasta, etc.", items: 1 },
    ]);
  });

  it("keeps the recipe's own words, dropping only a trailing colon", () => {
    // "For the Chicken:" is how the page writes it; the review screen's text channel stores
    // "For the Chicken" for the same heading, and two paths must not disagree about one page
    const html = card([
      { heading: "For the Chicken:", items: ["1 lb chicken"] },
      { heading: "For the Potatoes:", items: ["2 lb potatoes"] },
    ]);
    expect(ingredientGroups(html).map((g) => g.heading)).toEqual(["For the Chicken", "For the Potatoes"]);
  });

  /*
   * **This assertion inverted when the design changed, and the old one looked stricter.** It used
   * to require `[]` here — unheaded blocks skipped entirely — which is exactly what made a recipe
   * with a few ingredients above its first heading lose *every* section: those rows went missing
   * from the total, the alignment check failed, and the whole list stored flat. Counting them with
   * a null heading is the fix, so the run with no name is now a run.
   *
   * A heading with nothing under it is still not a run, and that half never changed.
   */
  it("counts a run the page did not name, and ignores a heading with nothing under it", () => {
    const html =
      `<div class="wprm-recipe-ingredient-group"><ul><li class="wprm-recipe-ingredient">1 egg</li></ul></div>` +
      `<div class="wprm-recipe-ingredient-group"><h4>Garnish</h4></div>`;
    expect(ingredientGroups(html)).toEqual([{ heading: null, items: 1 }]);
  });

  it("does not treat an entirely unnamed card as a grouping", () => {
    const html =
      `<div class="wprm-recipe-ingredient-group"><ul><li class="wprm-recipe-ingredient">1 egg</li></ul></div>` +
      `<div class="wprm-recipe-ingredient-group"><ul><li class="wprm-recipe-ingredient">2 cups flour</li></ul></div>`;
    const read = sectionedIngredients(["1 egg", "2 cups flour"], html);
    expect(read.groups).toBe(0);
    expect(read.aligned).toBe(true);
    expect(read.ingredients.every((i) => !i.section)).toBe(true);
  });
});

describe("assigning sections from a card's groups", () => {
  it("puts each run under its own heading", () => {
    const read = sectionedIngredients(SPAGHETTIOS_LINES, SPAGHETTIOS);
    expect(read.aligned).toBe(true);
    expect(read.ingredients.map((i) => [i.item, i.section])).toEqual([
      ["beef broth", "Sauce"],
      ["half and half", "Sauce"],
      ["ground beef", "Mini Meatballs"],
      ["egg", "Mini Meatballs"],
      ["butter", "Pasta, etc."],
    ]);
  });

  /*
   * regression: the reason this assigns structurally instead of splicing "Sauce:" into the list.
   *
   * `headingOf` refuses any candidate containing a quantity, because in free text `2 cups flour:`
   * is an ingredient. This heading is real — The BEST Meatball Recipe writes it — and contains
   * "3-4 cups", so through the text channel it would be refused as a heading and then parsed as an
   * ingredient. A heading read as an ingredient gets bought.
   */
  it("keeps a heading that contains a quantity off the shopping list", () => {
    const heading = "For Sauce (Or you may substitute 3-4 cups of your favorite, quality marinara sauce)";
    const html = card([
      { heading: "For Meatballs", items: ["1 lb beef"] },
      { heading, items: ["28 oz crushed tomatoes"] },
    ]);
    const read = sectionedIngredients(["1 lb beef", "28 oz crushed tomatoes"], html);
    expect(read.ingredients.map((i) => i.item)).toEqual(["beef", "crushed tomatoes"]);
    expect(read.ingredients.map((i) => i.section)).toEqual(["For Meatballs", heading]);
  });

  it("stores flat when the counts disagree, and says why", () => {
    // one ingredient more than the groups account for: the reader is looking at markup it does not
    // understand, and a heading over the wrong run tells the cook to put parmesan in the marinade
    const read = sectionedIngredients([...SPAGHETTIOS_LINES, "1 cup parmesan"], SPAGHETTIOS);
    expect(read.aligned).toBe(false);
    expect(read.ingredients.every((i) => i.section === undefined || i.section === null)).toBe(true);
    expect(read.note).toContain("stored flat");
    expect(read.note).toContain("published 6 ingredients");
  });

  it("treats one named group as a list with a title, not a division", () => {
    const html = card([{ heading: "Ingredients", items: ["1 egg", "2 cups flour"] }]);
    const read = sectionedIngredients(["1 egg", "2 cups flour"], html);
    expect(read.groups).toBe(1);
    expect(read.ingredients.every((i) => !i.section)).toBe(true);
  });

  it("leaves an ungrouped recipe exactly as it was", () => {
    const read = sectionedIngredients(["1 egg", "2 cups flour"], "<ul><li>1 egg</li></ul>");
    expect(read.groups).toBe(0);
    expect(read.aligned).toBe(true);
    expect(read.ingredients.map((i) => i.item)).toEqual(["egg", "flour"]);
  });

  /*
   * The off-by-one control. Ungrouped lines before the first heading are common, and this is where
   * a slicing bug puts the first ingredients under the wrong name — the failure that is plausible
   * on screen and invisible in a count.
   */
  it("leaves the lines above the first heading unsectioned and starts the runs after them", () => {
    const html =
      `<div class="wprm-recipe-ingredient-group"><ul>` +
      `<li class="wprm-recipe-ingredient">1 tablespoon olive oil</li>` +
      `<li class="wprm-recipe-ingredient">1 onion</li></ul></div>` +
      card([
        { heading: "Sauce", items: ["2 cups broth"] },
        { heading: "Meatballs", items: ["1 lb beef"] },
      ]);
    const read = sectionedIngredients(
      ["1 tablespoon olive oil", "1 onion", "2 cups broth", "1 lb beef"],
      html,
    );
    expect(read.aligned).toBe(true);
    expect(read.ingredients.map((i) => [i.item, i.section ?? null])).toEqual([
      ["olive oil", null],
      ["onion", null],
      ["broth", "Sauce"],
      ["beef", "Meatballs"],
    ]);
  });

  it("moves nothing when the parser drops a line it cannot read", () => {
    // the slice is parsed per group, so an unreadable line shortens its own run and the headings
    // after it do not shift — which is what an interleaved heading line could not guarantee
    const html = card([
      { heading: "Sauce", items: ["2 cups broth", "???"] },
      { heading: "Meatballs", items: ["1 lb beef"] },
    ]);
    const read = sectionedIngredients(["2 cups broth", "", "1 lb beef"], html);
    expect(read.aligned).toBe(true);
    expect(read.ingredients.map((i) => [i.item, i.section])).toEqual([
      ["broth", "Sauce"],
      ["beef", "Meatballs"],
    ]);
  });
});
