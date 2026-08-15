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

/**
 * Foods that used to be one entry.
 *
 * Whole milk is nearly twice skim, Greek yogurt half again plain, and mince runs 176 to 332 by
 * lean percentage — spreads far too wide for one figure to stand for all of them (decisions §43).
 * Splitting them buys accuracy at a real risk: a new entry can steal a name from the old one, and
 * a name nobody matches is worse than a name matched roughly. These are that risk, held down.
 */
describe("entries split apart because one figure could not cover them", () => {
  const catalog = createCatalog(SEED_CATALOG);
  const energyOf = (name: string) => catalog.find(name)?.kcalPer100g;

  it("reads the specific sort as the specific sort, not as the generic", () => {
    // longest-name-first is what makes this work: "semi skimmed milk" beats "milk" outright
    expect(catalog.find("skimmed milk")?.key).toBe("skimmed-milk");
    expect(catalog.find("semi skimmed milk")?.key).toBe("semi-skimmed-milk");
    expect(catalog.find("greek yogurt")?.key).toBe("greek-yogurt");
    expect(catalog.find("lean ground beef")?.key).toBe("lean-ground-beef");
    expect(catalog.find("corn tortillas")?.key).toBe("corn-tortillas");
    expect(catalog.find("mature cheddar")?.key).toBe("cheddar");
  });

  it("still answers the bare word, because most recipes write the bare word", () => {
    // the generic keeps the common sort: unqualified "milk" is whole, "mince" is ordinary mince
    expect(catalog.find("milk")?.key).toBe("milk");
    expect(catalog.find("yogurt")?.key).toBe("yogurt");
    expect(catalog.find("beef mince")?.key).toBe("ground-beef");
    expect(catalog.find("tortillas")?.key).toBe("tortillas");
  });

  it("separates figures that a single entry was averaging away", () => {
    expect(energyOf("whole milk")).toBe(61);
    expect(energyOf("skim milk")).toBe(34);
    expect(energyOf("greek yogurt")).toBe(97);
    expect(energyOf("plain yogurt")).toBe(61);
    // the widest spread in the catalog: 80/20 against 90/10
    expect(energyOf("ground beef")).toBe(254);
    expect(energyOf("lean ground beef")).toBe(176);
    // flour against corn is a bigger gap than most people expect
    expect(energyOf("flour tortilla")).toBe(306);
    expect(energyOf("corn tortilla")).toBe(218);
  });

  it("lets no two entries claim the same name", () => {
    /*
     * regression: the risk splitting introduces. `find` takes the longest match and resolves ties
     * by whichever item is reached first, so two entries sharing a name means one silently wins
     * and the loser is unreachable — a catalog that looks bigger while answering worse.
     */
    const owners = new Map<string, string[]>();
    for (const item of SEED_CATALOG) {
      for (const name of item.names) {
        owners.set(name, [...(owners.get(name) ?? []), item.key]);
      }
    }
    const shared = [...owners].filter(([, keys]) => keys.length > 1);
    expect(shared.map(([name, keys]) => `${name}: ${keys.join(" and ")}`)).toEqual([]);
  });

  it("sends every name a recipe might write to the right entry", () => {
    /*
     * regression: the other half of the risk, and it needs the *key* rather than merely a hit.
     * `find` falls back to a substring match, so dropping "2% milk" entirely still resolves —
     * to `milk`, quietly, at 61 rather than 50. Asserting only that something was found is an
     * assertion that cannot fail for the reason it was written.
     */
    const expected: Array<[string, string]> = [
      ["whole milk", "milk"], ["milk", "milk"],
      ["2% milk", "semi-skimmed-milk"], ["semi skimmed milk", "semi-skimmed-milk"],
      ["skim milk", "skimmed-milk"], ["skimmed milk", "skimmed-milk"],
      ["flour tortilla", "flour-tortillas"], ["flour tortillas", "flour-tortillas"],
      ["corn tortilla", "corn-tortillas"], ["corn tortillas", "corn-tortillas"],
      ["tortilla", "tortillas"], ["tortillas", "tortillas"],
      ["shredded mozzarella", "mozzarella"], ["mozzarella", "mozzarella"],
      ["shredded cheddar", "cheddar"], ["cheddar", "cheddar"],
      ["monterey jack", "shredded-cheese"], ["shredded cheese", "shredded-cheese"],
      ["ground beef", "ground-beef"], ["ground chuck", "ground-beef"],
      ["beef mince", "ground-beef"], ["hamburger", "ground-beef"],
      ["lean ground beef", "lean-ground-beef"], ["5% fat mince", "lean-ground-beef"],
      ["greek yogurt", "greek-yogurt"], ["plain yogurt", "yogurt"],
      ["yoghurt", "yogurt"], ["yogurt", "yogurt"],
      ["double cream", "double-cream"], ["single cream", "single-cream"],
      ["heavy cream", "heavy-cream"], ["half and half", "half-and-half"],
    ];
    const wrong = expected
      .map(([name, key]) => [name, key, catalog.find(name)?.key] as const)
      .filter(([, key, got]) => got !== key)
      .map(([name, key, got]) => `${name}: wanted ${key}, got ${got ?? "nothing"}`);
    expect(wrong).toEqual([]);
  });

  it("reaches an alias whose punctuation normalisation strips", () => {
    /*
     * regression: aliases were indexed as written and queried after normalisation, so "2% milk"
     * — indexed with the percent sign, looked up without it — was unreachable and fell through
     * to `milk`. A silently wrong figure, not a visible gap.
     */
    expect(catalog.find("2% milk")?.key).toBe("semi-skimmed-milk");
    expect(catalog.find("5% fat mince")?.key).toBe("lean-ground-beef");
  });

  it("does not let a derived alias shadow a more specific one", () => {
    // the cost of the fix, held down: "diced tomatoes" normalises to "tomatoes", and a tin is
    // not fresh produce. The derived form is dropped wherever another item already claims it.
    expect(catalog.find("diced tomatoes")?.key).toBe("canned-tomatoes");
    expect(catalog.find("tomatoes")?.key).toBe("tomatoes");
  });

  it("gives every split entry a figure, since the split exists to carry one", () => {
    for (const key of [
      "milk", "semi-skimmed-milk", "skimmed-milk", "yogurt", "greek-yogurt",
      "ground-beef", "lean-ground-beef", "cheddar", "mozzarella",
      "flour-tortillas", "corn-tortillas",
    ]) {
      const item = SEED_CATALOG.find((i) => i.key === key);
      expect(item?.kcalPer100g, key).toBeTypeOf("number");
    }
  });
});
