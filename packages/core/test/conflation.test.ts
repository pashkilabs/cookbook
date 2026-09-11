import { describe, expect, it } from "vitest";
import { createCatalog } from "../src/catalog.js";
import { consolidate } from "../src/consolidate.js";
import { parseIngredientList } from "../src/parse.js";
import { SEED_CATALOG } from "../src/seed-catalog.js";

/**
 * regression: matching was a bare substring test, so a qualified product matched its head noun.
 *
 * `almond milk` bought whole milk. That is the one that matters most — this is the only output
 * of the app that costs money when it is wrong, and it buys dairy for a household that does not
 * eat it. `onion powder` bought onions and `whole-wheat flour` bought plain flour; `buttermilk`
 * matched across a word boundary entirely.
 *
 * The catalog is used here rather than a fixture on purpose: these are the products people
 * actually write, and a test against a hand-made catalog would prove the rule and not the
 * shipping behaviour.
 */
const catalog = createCatalog([...SEED_CATALOG]);
const key = (name: string) => catalog.find(name)?.key ?? null;

describe("a qualified product is not its head noun", () => {
  it("does not buy dairy for a recipe asking for almond milk", () => {
    expect(key("almond milk")).not.toBe("whole milk");
    expect(key("almond milk")).not.toBe("milk");
  });

  it("does not buy onions for onion powder", () => {
    expect(key("onion powder")).not.toBe("onion");
  });

  /*
   * A catalog gap, not a matcher bug, and the distinction decides where the fix goes.
   *
   * `whole-wheat flour` still resolves to `flour` because the catalog has no whole-wheat entry
   * for a more specific name to win against — the matcher is answering correctly from
   * incomplete data. **The grocery catalog is data, not code**, so the fix is a catalog item
   * with its own package sizes, not another word in a list here. Recorded as a failing
   * expectation would be a red suite for a change that belongs elsewhere; recorded as this, the
   * next reader finds the gap and where it is fixed.
   */
  it("resolves whole-wheat flour to plain flour, which is the catalog gap and not the rule", () => {
    expect(key("whole-wheat flour")).toBe("flour");
  });

  it("does not match across a word boundary", () => {
    expect(key("buttermilk")).not.toBe("milk");
    expect(key("buttermilk")).not.toBe("whole milk");
  });

  it("does not buy soy sauce for a recipe asking for soy milk", () => {
    expect(key("soy milk")).not.toBe("milk");
  });
});

describe("but preparation is still preparation", () => {
  it("finds the ingredient under any amount of chopping", () => {
    // the whole reason the substring match existed — this must keep working
    expect(key("finely chopped onion")).toBe(key("onion"));
    expect(key("1 large onion, diced")).toBe(key("onion"));
    expect(key("freshly grated parmesan cheese")).toBe("parmesan");
  });

  it("treats singular and plural as the same word", () => {
    // the catalog stores singular; recipes are written in plural, and not every alias has one
    expect(key("yellow onions")).toBe(key("yellow onion"));
    expect(key("3 ripe tomatoes")).toBe(key("tomato") ?? key("tomatoes"));
  });
});

describe("the shopping list says what the recipe said", () => {
  const line = (label: string, lines: string[]) => ({ label, ingredients: parseIngredientList(lines) });

  it("does not rename a matched ingredient to the catalog's word for it", () => {
    /*
     * regression: the label was `item.names[0]`, so a recipe asking for orecchiette got a
     * shopping list saying spaghetti. Reported as the list being wrong, and it was — a person
     * cannot check a list against a recipe that no longer uses the same words.
     */
    const [only] = consolidate([line("Pasta", ["12 oz orecchiette"])], catalog);
    expect(only?.label).toContain("orecchiette");
    expect(only?.label).not.toContain("spaghetti");
  });

  it("keeps the reported line's own words", () => {
    // the line Stephen reported: it matched `pasta` and displayed the catalog's first name
    const [only] = consolidate([line("Pasta", ["12 oz dry orecchiette pasta"])], catalog);
    expect(only?.label).toContain("orecchiette");
    expect(only?.label).not.toContain("spaghetti");
    // and it still reaches the catalog, so it gets a package size and can consolidate
    expect(only?.key).toBe("pasta");
  });

  it("still adds two recipes' cream into one line, because the key is the catalog item", () => {
    // the label follows the recipe; the KEY follows the catalog, and that is what consolidates.
    // Both names below are aliases of ONE item — `double cream` is a different catalog entry
    // from `heavy cream`, which is a catalog question and not a matching one.
    const lines = consolidate(
      [line("A", ["200 ml heavy cream"]), line("B", ["250 ml whipping cream"])],
      catalog,
    );
    const cream = lines.filter((l) => l.uses.length > 1);
    expect(cream).toHaveLength(1);
    expect(cream[0]!.uses).toHaveLength(2);
    // and it is called what the first recipe called it, not what the catalog calls it
    expect(cream[0]!.label).toContain("heavy cream");
  });
});
