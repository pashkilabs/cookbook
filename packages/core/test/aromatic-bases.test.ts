import { describe, expect, it } from "vitest";
import { baseIngredients, createCatalog } from "../src/index.js";

/**
 * Mirepoix and sofrito are bases — the exclusion was right about one onion and wrong about the
 * technique. Both are cooked down and frozen specifically to be a foundation, which is the thing
 * this matcher exists to find.
 */
const catalog = createCatalog([]);
const asList = (items: readonly string[]) => items.map((item) => ({ item }));
const keys = (items: readonly string[]) => [...baseIngredients(asList(items), catalog).keys()].sort();

describe("an aromatic cluster is a base; a lone aromatic is not", () => {
  it("counts a complete mirepoix, because onion carrot celery IS the base", () => {
    expect(keys(["onion", "carrot", "celery"])).toEqual(["carrot", "celery", "onion"]);
  });

  it("counts a complete sofrito — and its pepper is a BELL pepper", () => {
    expect(keys(["tomato", "onion", "bell pepper", "garlic"])).toEqual(
      ["bell pepper", "garlic", "onion", "tomato"].sort(),
    );
  });

  // regression: the original rule excluded every aromatic, so the two best-attested bases in
  // European and Latin cooking were invisible to the matcher whose job is finding bases
  it("still ignores an onion and a garlic on their own, which is what the old reason described", () => {
    expect(keys(["onion", "garlic"])).toEqual([]);
  });

  it("does not treat onion, garlic and ginger as a base, because nobody batches it", () => {
    // a named technique is evidence; a count of aromatics is a guess
    expect(keys(["onion", "garlic", "ginger"])).toEqual([]);
  });

  it("needs the whole cluster — two thirds of a mirepoix is two vegetables", () => {
    expect(keys(["onion", "celery"])).toEqual(["celery"]);
  });

  it("keeps the carrot and celery it already counted, cluster or not", () => {
    // they were never aromatics; the change must not quietly drop what used to count
    expect(keys(["carrot", "celery"])).toEqual(["carrot", "celery"]);
  });
});
