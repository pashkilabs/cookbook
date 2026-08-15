import type { Catalog } from "./catalog.js";
import type { CatalogItem, ConsolidationEntry, Dimension } from "./types.js";
import { toBaseMeasure } from "./units.js";
import { isStaple, normaliseName } from "./text.js";

/**
 * Estimating what a meal is worth in energy, from the catalog rather than a network call.
 *
 * The arithmetic is the easy half and is the same arithmetic the shopping list already does:
 * convert an amount to base units, then to grams, then multiply by an energy density. What makes
 * this worth building carefully is the **other** half — knowing when it does not know.
 *
 * ---------------------------------------------------------------------------
 * Incomplete must look incomplete
 * ---------------------------------------------------------------------------
 *
 * Coverage is partial and always will be: a catalog cannot hold every ingredient anybody writes.
 * A total that silently omits the chorizo is worse than no total, because it is *plausible* — it
 * reads as a fact and it is wrong in the direction that flatters. So an estimate carries what it
 * could not account for, and the formatter refuses to state a bare number when anything is
 * missing: "at least ~480, 3 ingredients unknown" rather than "480".
 *
 * ---------------------------------------------------------------------------
 * Salt is nothing; oil is not
 * ---------------------------------------------------------------------------
 *
 * `isStaple` exists to keep the shopping list from telling somebody to buy salt. That is a
 * statement about **buying**, not about eating, and the two lists are not the same:
 *
 *   * Salt, pepper, water and ice carry no energy. They are *negligible*, not unknown — counting
 *     them as gaps would make every recipe look incomplete for no reason.
 *   * Oils carry a great deal. `2 tbsp olive oil` is about 240 kcal and belongs in the total even
 *     though nobody buys it per recipe.
 *   * `oil for frying`, with no amount, is genuinely **unknown** — and is exactly the kind of
 *     thing that should make the total say "at least".
 */

/**
 * Staples that are nothing: excluded from a total without being counted as a gap.
 *
 * Two rules rather than one, because a qualifier in front of a seasoning behaves differently by
 * seasoning. **"X salt" is still salt** — celery salt, garlic salt, rock salt, sea salt. But "X
 * pepper" is a vegetable as often as a spice, "X water" is frequently a drink, and "ice X" is
 * usually a dessert.
 *
 * regression: one rule matched any prefix or suffix for all of them and swallowed fifteen real
 * foods — bell, red, green, yellow, chilli, jalapeño and banana peppers, ice cream, water
 * chestnuts, coconut water, tonic water, salt cod, salt beef, pepper jack. Written in the plural
 * they escaped and were counted; written in the singular they were declared to be nothing. So
 * `1 bell pepper` was zero and `2 bell peppers` was 60, and the catalog held 26 kcal for it all
 * along. The staples rule is about **buying**; this is about eating, and a pepper is food.
 */
const NEGLIGIBLE_ENDING = ["salt"];

const NEGLIGIBLE_EXACT = [
  "pepper", "black pepper", "white pepper", "ground black pepper", "ground pepper",
  "cracked black pepper", "cracked pepper", "cayenne pepper", "lemon pepper",
  "peppercorns", "black peppercorns", "white peppercorns",
  "salt flakes", "sea salt flakes",
  "water", "boiling water", "hot water", "warm water", "ice water", "iced water",
  "filtered water", "rose water", "orange blossom water",
  "ice", "ice cubes", "crushed ice",
  "cooking spray", "olive oil spray", "nonstick spray", "non stick spray",
];

const MILLILITRES_PER_CUP = 236.588;

/** How much of a recipe must be accounted for before a floor is worth stating. See `formatEnergy`. */
const STATEABLE_FRACTION = 0.5;

export interface EnergyEstimate {
  /** kcal accounted for. Never the whole story unless `complete` is true. */
  kcal: number;
  /** ingredient lines that produced a figure */
  resolved: number;
  /** lines with no figure, by the text they were written as */
  unresolved: string[];
  /** lines known to carry no energy — salt, water. Not gaps. */
  negligible: string[];
  /** true when nothing was left out */
  complete: boolean;
  /** kcal per serving, when the recipe says what it serves */
  perServing: number | null;
}

export interface EnergyOptions {
  /** what the recipe serves at 1×; the multiplier is applied to both sides so this cancels */
  servings?: number | null;
}

const isNothing = (n: string): boolean =>
  NEGLIGIBLE_EXACT.includes(n) || NEGLIGIBLE_ENDING.some((s) => n === s || n.endsWith(` ${s}`));

const isNegligible = (name: string): boolean => {
  const n = normaliseName(name);
  if (!n) return false;
  // "salt and pepper" is one line naming two things, and it is nothing only if both are
  const parts = n.split(/\s+(?:and|&)\s+/).filter(Boolean);
  return parts.length > 1 ? parts.every(isNothing) : isNothing(n);
};

/**
 * Grams, from whatever the recipe wrote.
 *
 * Energy is per 100 g, so everything has to become grams — which is a different question from the
 * shopping list's, where volume-sold things stay in millilitres. Three routes, and each needs the
 * catalog to have said something:
 *
 *   weight  already grams
 *   volume  needs a density. `gramsPerCup` is the field that already carries it for items sold by
 *           weight and measured by volume; here it is read for volume items too.
 *   count   needs a weight per item — an onion is not a gram and not a kilogram.
 *
 * Returns null rather than guessing. A guess here is the silent understatement this module is
 * built to avoid.
 */
export function toGrams(
  amount: number | null,
  unit: string | null,
  item: CatalogItem | null,
): number | null {
  const measure = toBaseMeasure(amount, unit, item);
  if (!measure || !Number.isFinite(measure.amount)) return null;

  const dimension: Dimension = measure.dimension;
  if (dimension === "weight") return measure.amount;

  if (dimension === "volume") {
    if (!item?.gramsPerCup) return null;
    return (measure.amount / MILLILITRES_PER_CUP) * item.gramsPerCup;
  }

  // count, clove, bunch — all "how many of a thing", all needing a weight for one
  if (!item?.gramsEach) return null;
  return measure.amount * item.gramsEach;
}

/**
 * What a set of planned recipes is worth in energy.
 *
 * Takes the same entries the shopping list takes, so **a plan entry's multiplier is respected by
 * construction**: `scale` multiplies the amounts, exactly as it does for what you buy. Cooking
 * half again as much is half again as much food.
 */
export function estimateEnergy(
  entries: ConsolidationEntry[],
  catalog: Catalog,
  options: EnergyOptions = {},
): EnergyEstimate {
  let kcal = 0;
  let resolved = 0;
  const unresolved: string[] = [];
  const negligible: string[] = [];

  for (const entry of entries) {
    const scale = entry.scale ?? 1;

    for (const ingredient of entry.ingredients) {
      const name = ingredient.item;
      if (!name) continue;

      if (isNegligible(name)) {
        negligible.push(name);
        continue;
      }

      const item = catalog.find(name);
      const density = item?.kcalPer100g;
      if (!item || density === undefined) {
        // the catalog has never heard of it, or knows it without knowing its energy
        unresolved.push(name);
        continue;
      }

      const grams = toGrams(
        ingredient.amount === null ? null : ingredient.amount * scale,
        ingredient.unit,
        item,
      );
      if (grams === null) {
        /*
         * Known ingredient, unusable amount — "oil for frying", "a handful of parsley", or a unit
         * the catalog cannot turn into grams. A staple with no amount lands here, which is the
         * correct answer: it is not nothing, and it is not knowable.
         */
        unresolved.push(name);
        continue;
      }

      kcal += (grams / 100) * density;
      resolved += 1;
    }
  }

  const complete = unresolved.length === 0 && resolved > 0;
  const servings = options.servings ?? null;

  return {
    kcal,
    resolved,
    unresolved,
    negligible,
    complete,
    perServing: servings && servings > 0 ? kcal / servings : null,
  };
}

/**
 * Round to something a recipe can honestly claim.
 *
 * `517` asserts a precision nothing here has. One onion varies twofold by size, a "medium"
 * chicken breast by more, and how much of a marinade is eaten rather than left in the dish is
 * unknowable. Ten kcal is already finer than the input deserves; it is chosen because a round
 * hundred would look like a refusal to answer.
 */
export const roundEnergy = (kcal: number): number => Math.round(kcal / 10) * 10;

/**
 * The estimate as a sentence.
 *
 * Three shapes, because there are three genuinely different things to say:
 *
 *   complete      "~520"                                a number, hedged only by the tilde
 *   partial       "at least ~480 · 3 ingredients unknown"  a floor, and how far from complete
 *   nothing       "no estimate"                          rather than "0", which is a claim
 *
 * The floor wording is the point. A partial total is a *lower bound* and saying "at least" makes
 * that true rather than merely implied — somebody reading "480" would take it as the answer.
 */
export function formatEnergy(estimate: EnergyEstimate, per: "total" | "serving" = "total"): string {
  const value = per === "serving" ? estimate.perServing : estimate.kcal;
  if (value === null || estimate.resolved === 0) return "no estimate";

  const rounded = roundEnergy(value);
  /*
   * regression: a floor that rounds to nothing is not a floor. `at least ~0` was printed as a
   * per-serving figure for a rack of ribs where one line of twelve resolved — the module declined
   * to say `0` when it knew nothing, but not when it knew almost nothing, and `~0` reads as a
   * claim about the dish rather than a statement about us.
   */
  if (rounded === 0) return "no estimate";
  if (estimate.complete) return `~${rounded}`;

  /*
   * And a floor built from a minority of the ingredients is not worth stating either. Half is the
   * line: below it, what is missing outweighs what is counted, and "at least ~10" invites someone
   * to read a number that is wrong by an order of magnitude.
   *
   * Counted in lines rather than in mass, because the mass of an unknown ingredient is precisely
   * what is unknown. That is imperfect — a dal whose lentils and ghee are both missing clears the
   * bar on three lines of six while missing nearly all of its energy — but no better signal
   * exists without the figure we are short of.
   */
  const countable = estimate.resolved + estimate.unresolved.length;
  if (estimate.resolved / countable < STATEABLE_FRACTION) return "no estimate";

  const missing = estimate.unresolved.length;
  return `at least ~${rounded} · ${missing} ingredient${missing === 1 ? "" : "s"} unknown`;
}
