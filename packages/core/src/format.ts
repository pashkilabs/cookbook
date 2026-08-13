import type { Dimension } from "./types.js";
import { formatQuantity } from "./text.js";
import { UNITS } from "./units.js";

/** Millilitres in the unit a cook would say out loud. */
export function formatVolume(ml: number): string {
  if (ml >= UNITS.gallon!.toBase * 0.9) return `${formatQuantity(ml / UNITS.gallon!.toBase)} gal`;
  if (ml >= UNITS.quart!.toBase * 0.9) return `${formatQuantity(ml / UNITS.quart!.toBase)} qt`;
  if (ml >= 115) return `${formatQuantity(ml / UNITS.cup!.toBase)} cup`;
  if (ml >= UNITS.tbsp!.toBase * 0.9) return `${formatQuantity(ml / UNITS.tbsp!.toBase)} tbsp`;
  return `${formatQuantity(ml / UNITS.tsp!.toBase)} tsp`;
}

export function formatWeight(g: number): string {
  if (g >= UNITS.lb!.toBase * 0.9) return `${formatQuantity(g / UNITS.lb!.toBase)} lb`;
  if (g >= 25) return `${Math.round(g / UNITS.oz!.toBase)} oz`;
  return `${Math.round(g)} g`;
}

const COUNTABLE: Partial<Record<Dimension, [string, string]>> = {
  clove: ["clove", "cloves"],
  can: ["can", "cans"],
  bunch: ["bunch", "bunches"],
};

export function formatMeasure(amount: number, dimension: Dimension): string {
  if (dimension === "volume") return formatVolume(amount);
  if (dimension === "weight") return formatWeight(amount);
  const words = COUNTABLE[dimension];
  if (words) {
    const rounded = Math.round(amount * 100) / 100;
    return `${formatQuantity(amount)} ${rounded === 1 ? words[0] : words[1]}`;
  }
  return formatQuantity(amount);
}

/** How a recipe wrote it, e.g. `1½ cup` or `3`. */
export function formatAsWritten(amount: number | null, unit: string | null): string {
  const qty = formatQuantity(amount);
  if (!unit || unit === "count") return qty;
  return qty ? `${qty} ${unit}` : unit;
}

export function formatPackages(
  packages: Array<{ size: { label: string }; count: number }>,
): string | null {
  if (!packages.length) return null;
  if (packages.every((p) => p.size.label === "loose")) return null;
  return packages
    .map((p) =>
      p.size.label === "loose"
        ? `${p.count} more`
        : p.count > 1
          ? `${p.count} × ${p.size.label}`
          : p.size.label,
    )
    .join(" + ");
}

/**
 * Plurals, at display time.
 *
 * Catalog names are singular and canonical — `yellow onion`, `roma tomato` — because a name is
 * one thing and a list has to say "1 lemon" as often as "3 lemons". Storing the plural fixes one
 * and breaks the other, which is what "1½ lemons" beside "3 yellow onion" was.
 *
 * Only the **last word** is inflected: an ingredient name is a head noun with modifiers in front
 * of it, so `flour tortilla` becomes `flour tortillas` and never `flours tortilla`.
 *
 * Uncountables are listed rather than detected. English gives no reliable signal — `bread` and
 * `spread` differ only in what they mean — and getting `2 breads` wrong is worse than keeping a
 * list of thirty words honest.
 */
const IRREGULAR_PLURALS: Record<string, string> = {
  tomato: "tomatoes",
  potato: "potatoes",
  leaf: "leaves",
  loaf: "loaves",
  knife: "knives",
  half: "halves",
  shelf: "shelves",
  child: "children",
  goose: "geese",
  tooth: "teeth",
  foot: "feet",
  mouse: "mice",
  // already plural: a name that arrives plural stays put rather than growing an s
  greens: "greens",
  oats: "oats",
  grits: "grits",
  noodles: "noodles",
  lentils: "lentils",
  chives: "chives",
  sprouts: "sprouts",
};

/** Words with no plural in a kitchen. `2 rices` is never what anybody meant. */
const UNCOUNTABLE = new Set([
  "bread", "rice", "flour", "sugar", "salt", "pepper", "water", "milk", "cream", "butter",
  "oil", "vinegar", "honey", "syrup", "broth", "stock", "wine", "sauce", "paste", "juice",
  "yogurt", "yoghurt", "mayonnaise", "mustard", "ketchup", "cheese", "pasta", "spinach",
  "broccoli", "celery", "garlic", "ginger", "parsley", "cilantro", "coriander", "basil",
  "thyme", "oregano", "rosemary", "cinnamon", "paprika", "cumin", "turmeric", "seasoning",
  "quinoa", "couscous", "polenta", "cornstarch", "cornflour", "yeast", "salmon", "cod",
  "beef", "pork", "lamb", "chicken", "turkey", "fish", "bacon", "chorizo", "ham", "mince",
]);

/**
 * Phrases whose head noun is uncountable but which are themselves countable.
 *
 * `pepper` the spice has no plural; a `bell pepper` is a vegetable you buy three of. The head
 * noun cannot settle this on its own, so the two-word tail is checked first.
 */
const COUNTABLE_PHRASES = new Set([
  "bell pepper", "sweet pepper", "chilli pepper", "chili pepper", "green pepper", "red pepper",
]);

export function pluralise(name: string): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return trimmed;

  const words = trimmed.split(/\s+/);
  const last = words[words.length - 1]!;
  const lower = last.toLowerCase();
  const tail = words.slice(-2).join(" ").toLowerCase();

  if (UNCOUNTABLE.has(lower) && !COUNTABLE_PHRASES.has(tail)) return trimmed;

  const irregular = IRREGULAR_PLURALS[lower];
  if (irregular) {
    words[words.length - 1] = matchCase(last, irregular);
    return words.join(" ");
  }

  // already plural by the look of it: "cloves", "greens". Not exhaustive, and it does not need
  // to be — the catalog is singular, and this is the guard for anything else that arrives.
  if (lower.endsWith("s") && !lower.endsWith("ss")) return trimmed;

  let plural: string;
  if (/[^aeiou]y$/.test(lower)) plural = `${lower.slice(0, -1)}ies`;
  else if (/(s|x|z|ch|sh)$/.test(lower)) plural = `${lower}es`;
  else plural = `${lower}s`;

  words[words.length - 1] = matchCase(last, plural);
  return words.join(" ");
}

/** "3 yellow onions", "1 lemon", "1½ lemons". Empty when there is no amount to state. */
export function formatCountable(amount: number | null | undefined, singular: string): string {
  const name = String(singular ?? "").trim();
  if (amount == null) return name;
  const quantity = formatQuantity(amount);
  const noun = amount === 1 ? name : pluralise(name);
  return quantity ? `${quantity} ${noun}` : noun;
}

/** Keeps "Lemon" capitalised if it arrived that way. */
function matchCase(original: string, replacement: string): string {
  if (original[0] && original[0] === original[0].toUpperCase() && original !== original.toUpperCase()) {
    return replacement[0]!.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
