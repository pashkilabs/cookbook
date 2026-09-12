import { describe, expect, it } from "vitest";
import { createCatalog } from "../src/catalog.js";
import { consolidate } from "../src/consolidate.js";
import { parseIngredientList } from "../src/parse.js";
import { SEED_CATALOG, METRIC_PACKAGES } from "../src/seed-catalog.js";
import { CONTAINER_WORDS } from "../src/units.js";

const catalog = createCatalog([...SEED_CATALOG]);
const buy = (text: string) =>
  consolidate([{ label: "probe", ingredients: parseIngredientList([text]) }], catalog)[0];

/**
 * regression: `1 block of cream cheese` rendered as **"1 can cream cheese"** with no package.
 *
 * The parser canonicalises every container word to the `can` dimension, and without a
 * per-ingredient size there is nothing to convert it into — so the shopping list showed a unit
 * nobody writes and suggested nothing to buy. The catalog knew the answer the whole time: its
 * package is literally labelled `8 oz block`. Nothing connected the two.
 */
describe("a container word a recipe writes", () => {
  it("becomes a real measure when the catalog knows that container's size", () => {
    expect(buy("1 block of cream cheese")?.neededDisplay).toBe("8 oz");
    expect(buy("1 block of cream cheese")?.packagesDisplay).toBe("8 oz block");
  });

  it("scales, so two blocks are a pound rather than two cans", () => {
    expect(buy("2 blocks of cream cheese")?.neededDisplay).toBe("1 lb");
  });

  it("works for the words a tinned aisle is written in", () => {
    expect(buy("1 can tomato paste")?.neededDisplay).toBe("6 oz");
    expect(buy("1 jar of honey")?.packagesDisplay).toContain("jar");
  });

  /**
   * The limitation, asserted so it is a decision rather than an oversight.
   *
   * `containers` is one map per item with no market dimension, while package sizes have one
   * (§28: a pint is 473 ml and a metric carton is 500). A US block of butter is 454 g and a
   * metric one is 250 g, and the catalog carries only the metric size — so an entry would
   * answer confidently for a market it has no size for. Left unanswered on purpose.
   */
  it("says nothing for a word that means different sizes in different markets", () => {
    expect(buy("1 block of butter")?.packagesDisplay).toBeNull();
  });

  it("has no package naming a container size it cannot then use", () => {
    /*
     * The audit that found this, kept as a test so the next catalog entry cannot re-open it
     * silently. A package labelled "8 oz block" with no `block` in `containers` is a promise
     * the catalog makes and cannot keep — unless the word means two different things, which is
     * the market case above and is allowed.
     */
    const words = [...CONTAINER_WORDS].sort((a, b) => b.length - a.length);
    const unkept: string[] = [];
    for (const item of SEED_CATALOG) {
      const sizes = [...(item.packages ?? []), ...(METRIC_PACKAGES[item.key] ?? [])];
      const byWord = new Map<string, Set<number>>();
      for (const size of sizes) {
        const word = words.find((w) => new RegExp(`(^|[\\s-])${w}s?([\\s-]|$)`).test(size.label.toLowerCase()));
        if (!word) continue;
        byWord.set(word, new Set([...(byWord.get(word) ?? []), size.amount]));
      }
      for (const [word, amounts] of byWord) {
        if (amounts.size > 1) continue; // ambiguous, and deliberately unanswered
        if (item.containers?.[word] === undefined) unkept.push(`${item.key}: "${word}" (${[...amounts][0]})`);
      }
    }
    /*
     * Both exceptions are named, so this is a claim rather than a tolerance. Each is a word the
     * catalog carries in one market only while the other market uses the same word for a
     * different size: a US block of butter is 454 g against a metric 250, and a US bag of
     * spinach is 5 or 10 oz against a metric 250 g. Answering either would be confident about a
     * market the catalog has no size for. A `containers` map per market would settle both.
     */
    expect(unkept.sort()).toEqual(['butter: "block" (250)', 'spinach: "bag" (250)']);
  });
});
