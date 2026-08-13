import { describe, expect, it } from "vitest";
import { createCatalog } from "../src/catalog.js";
import { SEED_CATALOG } from "../src/seed-catalog.js";

/**
 * Aisle assignment for things the catalog does not carry.
 *
 * `aisleFor` falls back to keyword hints, and "Other" is where something lands when no hint
 * matched — a bucket for the unclassifiable, not a shelf anybody walks to. Anything ordinary
 * ending up there is a gap in the hints.
 */
describe("aisles for things the catalog does not carry", () => {
  const catalog = createCatalog(SEED_CATALOG);

  it("shelves dried carbohydrates in the pantry", () => {
    // regression: the first real week put "300 g tagliatelle" in Other
    for (const name of [
      "tagliatelle",
      "spaghetti",
      "dried linguine",
      "penne",
      "arborio rice",
      "polenta",
    ]) {
      expect(catalog.aisleFor(name), name).toBe("Pantry");
    }
  });

  it("still sends fresh things to produce and meat", () => {
    // the hints are searched in order, so adding to one list must not steal from another
    expect(catalog.aisleFor("chicken thighs")).toBe("Meat & Seafood");
    expect(catalog.aisleFor("sweet potato")).toBe("Produce");
    expect(catalog.aisleFor("rice vinegar")).toBe("Pantry");
    expect(catalog.aisleFor("double cream")).toBe("Dairy");
  });

  it("prefers the longest hint over the first aisle that matches", () => {
    // regression: hints were searched aisle by aisle and the first match won, which made the
    // order of AISLE_HINTS load-bearing. "chili powder" found "chili" in Produce — the fresh
    // vegetable — before reaching "chili powder" in Spices. The longer hint is the more
    // specific claim wherever it sits, which is the rule `find` already uses on catalog names.
    expect(catalog.aisleFor("chili powder")).toBe("Spices");
    expect(catalog.aisleFor("chilli")).toBe("Produce");
  });

  it("leaves something genuinely unclassifiable in Other", () => {
    expect(catalog.aisleFor("birthday candles")).toBe("Other");
  });
});
