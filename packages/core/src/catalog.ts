import type { CatalogItem, PackageSize } from "./types.js";
import { PREP_TOKENS, lightName, normaliseName } from "./text.js";

export const AISLE_ORDER = [
  "Produce", "Meat & Seafood", "Dairy", "Bakery", "Frozen", "Pantry", "Spices", "Other",
] as const;

/** Keyword fallbacks for items the catalog doesn't carry. */
const AISLE_HINTS: Record<string, string[]> = {
  Produce: ["lettuce", "kale", "cabbage", "zucchini", "courgette", "squash", "cucumber",
    "apple", "berries", "ginger", "jalapeno", "sweet potato", "asparagus", "corn",
    "pear", "banana", "herb", "shallot", "leek", "chilli", "chili", "salad", "greens"],
  "Meat & Seafood": ["chicken", "beef", "pork", "steak", "turkey", "fish", "cod",
    "tilapia", "chorizo", "ham", "meat", "mince", "prawn", "lamb"],
  Dairy: ["cheese", "cream", "milk", "yogurt", "yoghurt", "butter", "egg"],
  Bakery: ["bun", "roll", "pita", "naan", "bagel", "tortilla", "bread", "baguette"],
  Frozen: ["frozen", "ice cream", "puff pastry"],
  Spices: ["paprika", "cumin", "oregano", "thyme", "cinnamon", "chili powder",
    "garlic powder", "onion powder", "curry", "turmeric", "bay leaf",
    "red pepper flakes", "italian seasoning", "nutmeg", "cayenne", "seasoning",
    "vanilla", "coriander seed", "peppercorn"],
  Pantry: ["vinegar", "mustard", "ketchup", "mayo", "oats", "nuts", "raisin",
    "cornstarch", "cornflour", "baking soda", "baking powder", "yeast", "sesame",
    "sriracha", "salsa", "peanut butter", "quinoa", "couscous", "lentil", "panko",
    "breadcrumb", "wine", "broth", "stock", "syrup", "sauce",
    // dried carbohydrates: found missing when a real week put tagliatelle in "Other",
    // which is the aisle for things nobody could classify rather than a shelf in a shop
    "pasta", "spaghetti", "tagliatelle", "linguine", "penne", "macaroni", "fusilli",
    "noodle", "orzo", "rice", "polenta", "flour"],
};

export interface Catalog {
  find(name: string): CatalogItem | null;
  aisleFor(name: string): string;
  all(): CatalogItem[];
}

/**
 * Build a matcher over a set of catalog items.
 *
 * Matching runs against both an aggressive and a gentle normalisation of the
 * name, taking the longest match. Both are needed: the aggressive form makes
 * "finely chopped onion" find "onion", while the gentle form keeps "diced
 * tomatoes" (a tin) from collapsing into "tomatoes" (fresh produce).
 */
/**
 * Does this written name really name this catalog item — or merely contain its word?
 *
 * ---------------------------------------------------------------------------
 * The bug this replaces
 * ---------------------------------------------------------------------------
 *
 * Matching was `form.includes(candidate)`, a bare substring test, so **a qualified product
 * matched its head noun**: `almond milk` bought whole milk, `onion powder` bought onions,
 * `whole-wheat flour` bought plain flour. It also matched across word boundaries, so
 * `buttermilk` contained `milk`.
 *
 * This is the shopping list, which is the one output of this app that **costs money when it is
 * wrong** — and the almond-milk case buys dairy for a household that does not eat it. A wrong
 * recipe wastes an evening; this wastes a shop and breaks a diet.
 *
 * ---------------------------------------------------------------------------
 * An allow-list, because the failure directions are not symmetric
 * ---------------------------------------------------------------------------
 *
 * The rule is: the candidate must appear as **whole words**, and everything left over must be
 * *preparation* — the same words `normaliseName` already strips. `finely chopped onion` leaves
 * nothing and matches; `onion powder` leaves "powder" and does not.
 *
 * Stated as an allow-list on purpose, exactly as `photo_object_is_public` is. An exclusion list
 * of forbidden qualifiers would let every qualifier nobody has thought of through by default,
 * and the next `almond milk` is by definition one nobody has thought of.
 *
 * **Failing to match is the safe direction here**, which is what makes the strictness
 * affordable: an unmatched line still appears on the shopping list, under the name the recipe
 * gave it. It simply does not consolidate with others or get a package size. That is a much
 * smaller harm than buying the wrong product confidently.
 */
export function claims(form: string, candidate: string): boolean {
  const words = split(form);
  const wanted = split(candidate);
  if (wanted.length === 0 || wanted.length > words.length) return false;

  for (let at = 0; at + wanted.length <= words.length; at += 1) {
    if (!wanted.every((word, n) => sameWord(words[at + n]!, word))) continue;
    const before = words.slice(0, at);
    const residue = [...before, ...words.slice(at + wanted.length)];

    // "onion powder" is not onion, "bread crumbs" are not bread, "peanut butter" is not butter
    if (residue.some((word) => FORM_WORDS.has(word))) continue;

    /*
     * A bare head noun takes no qualifier: "almond milk" is not milk, "soy milk" is not milk.
     *
     * Only when the candidate IS the head noun on its own. `coconut milk` is its own product
     * and matching it exactly is right — rejecting that because the *name* contains "milk"
     * threw away the specific match in favour of nothing, which measured worse on every count.
     */
    if (FORM_WORDS.has(candidate) && before.some((word) => !isHarmless(word))) continue;

    return true;
  }
  return false;
}

const split = (text: string): string[] => text.split(/[\s-]+/).filter(Boolean);

/**
 * Words naming a **form or a product in their own right**, which change what you buy.
 *
 * Not a list of every qualifier — that list is open-ended and the attempt measured badly, giving
 * up 99 of 434 real matches to fix 11 conflations. This is the narrow claim that survived
 * measurement: fixes 10 of 11 known conflations while giving up 18, of which 16 were themselves
 * wrong matches (`peanut butter` was buying butter, `tomato ketchup` was buying tomatoes).
 *
 * `juice` and `zest` are deliberately absent: you buy a lemon for lemon juice.
 *
 * **The trade this encodes.** Failing to match is not free — an unmatched line still appears on
 * the shopping list, but it does not consolidate and gets no package size, and consolidation is
 * the thing this product exists to do. So the rule earns each rejection rather than rejecting on
 * suspicion.
 */
const FORM_WORDS: ReadonlySet<string> = new Set([
  "powder", "granules", "extract", "essence", "ketchup", "vinegar", "syrup",
  "crumbs", "breadcrumbs", "flakes", "seeds", "sauce", "oil", "milk", "butter",
  "paste", "stock", "broth", "wine", "jam", "jelly",
]);

/**
 * A leftover word that cannot change which product to buy.
 *
 * Numbers and measures are included because `find` is reachable with raw text — "1 large onion,
 * diced" leaves a "1" behind, "1/2 c. olive oil" leaves "c." — and neither names a product.
 */
const isHarmless = (word: string): boolean =>
  PREP_TOKENS.has(word) ||
  /^[\d.,/¼½¾⅓⅔⅛]+$/.test(word) ||
  MEASURE_WORDS.test(word) ||
  word === "of" || word === "or" || word === "and";

const MEASURE_WORDS =
  /^(c|tbsp|tsp|oz|lb|lbs|g|kg|ml|l|cup|cups|tablespoons?|teaspoons?|pints?|cloves?|bulbs?|stalks?|dollop|heaping|handful|pinch|cans?|jars?|packets?|bunch)\.?$/;

/**
 * Singular and plural are the same word.
 *
 * The catalog stores singular and recipes are written in plural, which is why plurals live in
 * `names` as aliases — but not every alias has one, and `yellow onions` must still find
 * `yellow onion`. Compared per word rather than by stripping the whole string, so `tomato paste`
 * is not quietly turned into `tomatoes paste`.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  return a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
}

export function createCatalog(items: CatalogItem[]): Catalog {
  const raw = items.flatMap((item) =>
    item.names.map((name) => ({ name: name.toLowerCase(), item })),
  );

  /*
   * An alias is indexed as written, but every query arrives normalised — so an alias containing
   * anything normalisation strips could never be matched by anything.
   *
   * regression: "2% milk" was indexed as `2% milk` and looked up as `2 milk`, which does not
   * contain it. The lookup fell through to the shorter `milk` and answered 61 kcal for a food
   * that is 50. "5% fat mince" matched nothing at all. Both looked like ordinary catalog gaps.
   *
   * The normalised form is added as a second candidate rather than replacing the first, because
   * normalisation is lossy in ways that matter here: `diced tomatoes` reduces to `tomatoes`, and
   * a tin is not fresh produce. So a derived candidate is dropped whenever some other item
   * already claims that exact string — the alias it would shadow is the more specific claim.
   */
  const claimed = new Set(raw.map((entry) => entry.name));
  const derived = raw
    .map((entry) => ({ name: normaliseName(entry.name), item: entry.item }))
    .filter((entry) => entry.name && !claimed.has(entry.name));

  const byLength = [...raw, ...derived].sort((a, b) => b.name.length - a.name.length);

  const cache = new Map<string, CatalogItem | null>();

  function find(name: string): CatalogItem | null {
    const raw = String(name ?? "");
    if (cache.has(raw)) return cache.get(raw) ?? null;

    const forms = [...new Set([normaliseName(raw), lightName(raw)])].filter(Boolean);
    let found: CatalogItem | null = null;
    outer: for (const { name: candidate, item } of byLength) {
      for (const form of forms) {
        if (form === candidate || claims(form, candidate)) {
          found = item;
          break outer;
        }
      }
    }
    cache.set(raw, found);
    return found;
  }

  /**
   * The longest matching hint wins, not the first aisle that matches.
   *
   * First-match-wins made the order of `AISLE_HINTS` load-bearing, and it lost: "egg noodles"
   * found "egg" in Dairy before reaching "noodle" in Pantry. Longest-match is the same rule
   * `find` already uses on catalog names, for the same reason — a longer hint is a more specific
   * claim, whichever list it happens to sit in.
   */
  function aisleFor(name: string): string {
    const item = find(name);
    if (item) return item.aisle;
    const n = normaliseName(name);

    let bestAisle = "Other";
    let bestLength = 0;
    for (const [aisle, words] of Object.entries(AISLE_HINTS)) {
      for (const word of words) {
        if (word.length > bestLength && n.includes(word)) {
          bestAisle = aisle;
          bestLength = word.length;
        }
      }
    }
    return bestAisle;
  }

  return { find, aisleFor, all: () => items };
}

/**
 * Choose what to actually buy for a required amount.
 *
 * Loose items are bought individually up to the point where a multipack makes
 * sense — nobody wants a bag of twelve lemons because a recipe asked for three.
 */
export function choosePackages(
  needed: number,
  sizes: PackageSize[],
): Array<{ size: PackageSize; count: number }> {
  if (!sizes.length || needed <= 0) return [];
  const sorted = [...sizes].sort((a, b) => a.amount - b.amount);
  const smallest = sorted[0]!;
  const nextUp = sorted[1];

  if (smallest.amount === 1 && (!nextUp || needed < nextUp.amount)) {
    return [{ size: smallest, count: Math.max(1, Math.ceil(needed - 0.01)) }];
  }

  const fits = sorted.find((s) => s.amount >= needed - 0.01);
  if (fits) return [{ size: fits, count: 1 }];

  const largest = sorted[sorted.length - 1]!;
  const whole = Math.floor(needed / largest.amount);
  const remainder = needed - whole * largest.amount;
  if (remainder <= 0.01) return [{ size: largest, count: whole }];

  const topUp = sorted.find((s) => s.amount >= remainder) ?? largest;
  if (topUp.label === largest.label) return [{ size: largest, count: whole + 1 }];
  return [
    { size: largest, count: whole },
    { size: topUp, count: 1 },
  ];
}
