/**
 * Which recipes share a base with one being planned — and what, exactly, they share.
 *
 * ---------------------------------------------------------------------------
 * The limitation, which is not a parameter
 * ---------------------------------------------------------------------------
 *
 * **Overlap cannot distinguish a base from a cuisine signature.** Both look the same from here:
 * several recipes carrying the same non-protein ingredients. The difference is whether those
 * items are *combined* — cooked into one thing you could make once — or merely *co-present*,
 * reached for separately off the same shelf. That is a claim about method, and §64 established
 * that an ingredient list cannot express method. This is that lesson arriving a third time.
 *
 * Measured on the real library: at five shared items this fires on 5 of 32 plan entries, and
 * **four of those five are one Mexican-seasoning cluster** — cumin, cilantro, avocado, lime,
 * cheese, shared by taco and chilli recipes that share a spice shelf and not a base. The fifth
 * is real: mirin, ginger paste, butter, carrots, mushrooms, zucchini, across two hibachi dishes.
 *
 * Tuning to six separates them cleanly — 1 of 1 real — and **buys that separation by going
 * silent**, firing once in thirty-two. The `ripeness` line already measured what silence is
 * worth, so the threshold stays at five and `shared` is returned so a screen can **name what is
 * shared**. A stated reason makes one-in-five a glance and a dismissal; a rank makes it noise.
 *
 * ---------------------------------------------------------------------------
 * It improves on its own
 * ---------------------------------------------------------------------------
 *
 * Base-sharing pairs grow with the *square* of the library, so 63 recipes is the worst case this
 * will ever face. Nothing here needs tuning as the corpus grows; the same threshold simply finds
 * more.
 */
import type { ParsedIngredient } from "./types.js";
import type { Catalog } from "./catalog.js";
import { isStaple, normaliseName } from "./text.js";

/**
 * Ingredients that could be part of a base, with the words the recipe used for them.
 *
 * Four exclusions, each for its own reason:
 *
 *   protein, carbohydrate   the thing a base is *finished with*, by definition — a shared
 *                           chicken is not a shared base
 *   staples                 salt, pepper, oil, water: present everywhere, meaning nothing
 *   bare aromatics          two recipes sharing onion and garlic share nothing worth saying
 */
const CARBOHYDRATE =
  /\b(pasta|spaghetti|noodle|rice|bread|roll|tortilla|bun|potato|flour|couscous|quinoa|orzo|macaroni|lasagn)/i;
const PROTEIN =
  /\b(chicken|beef|pork|lamb|turkey|bacon|sausage|mince|brisket|steak|shrimp|prawn|salmon|cod|tilapia|fish|tofu|egg)/i;
const AROMATIC = new Set(["onion", "garlic", "shallot", "ginger", "spring onion", "scallion"]);
const PROTEIN_AISLE = "Meat & Seafood";

export function baseIngredients(
  ingredients: ReadonlyArray<{ item: string }>,
  catalog: Catalog,
): Map<string, string> {
  // key -> the recipe's own words for it, because a shopping list that renames what a recipe
  // said is a list nobody can check against the recipe
  const out = new Map<string, string>();
  for (const ingredient of ingredients) {
    const text = ingredient.item;
    if (!text || isStaple(text)) continue;
    const item = catalog.find(text);
    const key = item ? item.key : normaliseName(text);
    if (!key) continue;
    if (item?.aisle === PROTEIN_AISLE) continue;
    if (PROTEIN.test(key) || CARBOHYDRATE.test(key)) continue;
    if (AROMATIC.has(key)) continue;
    if (!out.has(key)) out.set(key, normaliseName(text) || text);
  }
  return out;
}

export interface SharedBase<T> {
  recipe: T;
  /** catalog keys both carry — the count is the evidence */
  shared: string[];
  /** the planned recipe's own words for them, which is what a screen must show */
  labels: string[];
}

/**
 * Five, and chosen from a measured curve rather than asserted.
 *
 * At four this fires on 12 of 32 plan entries and is mostly a spice shelf. At six it fires once.
 * Five is where a stated reason carries the imprecision — see the header.
 */
export const SHARED_FOR_A_BASE = 5;

/**
 * The same query `recipesUsingLeftovers` is, with a different input.
 *
 * That one takes a set of leftover keys and keeps any candidate touching one; this takes a
 * planned recipe's base keys and keeps candidates overlapping by at least `shared`. Deliberately
 * the same shape, because it is the same question asked from the other end.
 */
export function recipesSharingBase<T extends { ingredients: ReadonlyArray<{ item: string }> }>(
  planned: { ingredients: ReadonlyArray<{ item: string }> },
  candidates: readonly T[],
  catalog: Catalog,
  options: { shared?: number } = {},
): Array<SharedBase<T>> {
  const wanted = options.shared ?? SHARED_FOR_A_BASE;
  const mine = baseIngredients(planned.ingredients, catalog);
  if (mine.size < wanted) return [];

  const found: Array<SharedBase<T>> = [];
  for (const candidate of candidates) {
    /*
     * The planned recipe is never its own suggestion.
     *
     * By reference, which covers the real case — a caller filtering its own library passes the
     * planned recipe inside the candidate array — and cannot cover a caller that rebuilt the
     * object from rows. Identity is not expressible here: this takes `{ ingredients }` and has
     * no id to compare. A caller holding ids should filter on them too, and the web one does.
     */
    if ((candidate as unknown) === (planned as unknown)) continue;
    const theirs = baseIngredients(candidate.ingredients, catalog);
    const shared = [...mine.keys()].filter((key) => theirs.has(key));
    if (shared.length < wanted) continue;
    found.push({ recipe: candidate, shared, labels: shared.map((key) => mine.get(key)!) });
  }
  // most shared first: the longer overlap is the more likely to be a base rather than a shelf
  return found.sort((a, b) => b.shared.length - a.shared.length);
}

/** `parseIngredientList` output, adapted — so a caller holding parsed lines need not reshape. */
export const asIngredients = (parsed: readonly ParsedIngredient[]): Array<{ item: string }> =>
  parsed.map((line) => ({ item: line.item }));
