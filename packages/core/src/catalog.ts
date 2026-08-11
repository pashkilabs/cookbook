import type { CatalogItem, PackageSize } from "./types.js";
import { lightName, normaliseName } from "./text.js";

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
    "breadcrumb", "wine", "broth", "stock", "syrup", "sauce"],
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
export function createCatalog(items: CatalogItem[]): Catalog {
  const byLength = items.flatMap((item) =>
    item.names.map((name) => ({ name: name.toLowerCase(), item })),
  ).sort((a, b) => b.name.length - a.name.length);

  const cache = new Map<string, CatalogItem | null>();

  function find(name: string): CatalogItem | null {
    const raw = String(name ?? "");
    if (cache.has(raw)) return cache.get(raw) ?? null;

    const forms = [...new Set([normaliseName(raw), lightName(raw)])].filter(Boolean);
    let found: CatalogItem | null = null;
    outer: for (const { name: candidate, item } of byLength) {
      for (const form of forms) {
        if (form === candidate || form.includes(candidate)) {
          found = item;
          break outer;
        }
      }
    }
    cache.set(raw, found);
    return found;
  }

  function aisleFor(name: string): string {
    const item = find(name);
    if (item) return item.aisle;
    const n = normaliseName(name);
    for (const [aisle, words] of Object.entries(AISLE_HINTS)) {
      if (words.some((w) => n.includes(w))) return aisle;
    }
    return "Other";
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
