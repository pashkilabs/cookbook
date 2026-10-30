import { describe, expect, it } from "vitest";
import { fingerprint } from "@pashki/core";
import { EXTRACTOR_VERSION } from "../src/cache-policy.js";
import { mapRecipeNode } from "../src/recipe.js";
import { buildNodeIndex, collectJsonLd, flattenNodes, findRecipeNode } from "../src/jsonld.js";

/**
 * A guard, because the reminder has now failed three times against people who know it.
 *
 * `EXTRACTOR_VERSION` sat at 1 through the two changes that made 2 necessary, and then at 2
 * through the change that made 3 necessary — the last one by me, in the session I had quoted the
 * comment about it. Every instance looks identical from outside: the cache serves a confident,
 * well-formed, stale recipe, and a fresh import of a page imported before returns last month's
 * answer. Nothing fails. The import is green, the tests are green, and the new extractor never ran.
 *
 * So this asks the question a person is supposed to remember: **does what the extractor produces
 * still match what this version claims it produces?** A fixed page in, a fingerprint of the whole
 * `ExtractedRecipe` out, pinned per version. Change the output and this fails until the version is
 * bumped and its new digest recorded — the same move `prompt-version.ts` makes for prompts, which
 * exists because `promptKey` had the same hand-stamp problem.
 *
 * **If this test fails, it is telling you one of two things.** Either you changed what the
 * extractor produces, in which case bump `EXTRACTOR_VERSION`, write what the new version *means*
 * beside it, and add its digest below — all three, in this commit. Or you changed it by accident,
 * which is the more valuable reading and the reason this is not simply derived automatically.
 *
 * It is deliberately not a check over the real fixture set: this is about the *shape* of one
 * answer, not accuracy, and a digest over thirty-five fixtures would move whenever any of them was
 * edited and tell nobody anything.
 *
 * **Two limits found by mutating it, both worth knowing before trusting it.**
 *
 * `fingerprint` lowercases, which is documented where it lives — so a change that only alters
 * capitalisation does not move the digest. Upper-casing every section passed this test and was
 * caught only by the assertion above it, which is why that assertion names the sections rather than
 * merely counting them.
 *
 * And the first version of this fixture had only `Sauce` and `Mini Meatballs`, so a mutant that
 * stripped a leading "For the " from every heading was a **no-op on it** and passed. A guard whose
 * fixture cannot express the change it is guarding against has nothing to watch — the oldest shape
 * in these notes, arriving inside a guard built to prevent a different one. The fixture now carries
 * both real heading shapes: a bare label and a `For the …:` with the colon this strips.
 */
const PAGE = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Guard Fixture",
  recipeYield: "4",
  totalTime: "PT40M",
  recipeIngredient: ["2 cups beef broth", "1/2 cup half and half", "3/4 lb. ground beef", "1 egg", "1 lb chicken"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Mix." }, { "@type": "HowToStep", text: "Bake." }],
})}</script></head><body>
<div class="wprm-recipe-ingredient-group"><h4>Sauce</h4><ul>
  <li class="wprm-recipe-ingredient">2 cups beef broth</li>
  <li class="wprm-recipe-ingredient">1/2 cup half and half</li>
</ul></div>
<div class="wprm-recipe-ingredient-group"><h4>Mini Meatballs</h4><ul>
  <li class="wprm-recipe-ingredient">3/4 lb. ground beef</li>
  <li class="wprm-recipe-ingredient">1 egg</li>
</ul></div>
<div class="wprm-recipe-ingredient-group"><h4>For the Chicken:</h4><ul>
  <li class="wprm-recipe-ingredient">1 lb chicken</li>
</ul></div>
</body></html>`;

/** the digest of the whole extracted recipe, per version — see the note above before editing */
const SHAPE_BY_VERSION: Record<number, string> = {
  3: "1:7ro219",
};

describe("the extractor's output shape is stamped", () => {
  const extract = () => {
    const nodes = flattenNodes(collectJsonLd(PAGE));
    const node = findRecipeNode(nodes);
    if (!node) throw new Error("the guard fixture has no Recipe node — fix the fixture, not the code");
    return mapRecipeNode({
      node,
      index: buildNodeIndex(nodes),
      baseUrl: "https://example.test/r",
      sourceUrl: "https://example.test/r",
      sourceName: null,
      html: PAGE,
    });
  };

  it("reads the fixture's groups at all, so the digest below is of something", () => {
    // a digest over an empty or ungrouped result would be stable and meaningless — the oldest
    // shape in this project's notes is a guard with nothing to watch
    const recipe = extract();
    expect(recipe.ingredients).toHaveLength(5);
    expect(recipe.ingredients.map((i) => i.section)).toEqual([
      "Sauce", "Sauce", "Mini Meatballs", "Mini Meatballs", "For the Chicken",
    ]);
  });

  it("matches the digest recorded for this EXTRACTOR_VERSION", () => {
    const digest = fingerprint([JSON.stringify(extract())]);
    const expected = SHAPE_BY_VERSION[EXTRACTOR_VERSION];
    expect(
      expected,
      `EXTRACTOR_VERSION is ${EXTRACTOR_VERSION} and no digest is recorded for it. ` +
        `If you bumped it, add ${JSON.stringify(digest)} to SHAPE_BY_VERSION.`,
    ).toBeDefined();
    expect(
      digest,
      `the extractor produces something different from what version ${EXTRACTOR_VERSION} recorded. ` +
        `If that is deliberate, bump EXTRACTOR_VERSION, say what the new version means beside it, ` +
        `and record ${JSON.stringify(digest)} — otherwise you have changed the output by accident.`,
    ).toBe(expected);
  });
});
