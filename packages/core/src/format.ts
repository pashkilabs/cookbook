import type { Dimension, MeasurementSystem } from "./types.js";
import { formatQuantity } from "./text.js";
import { UNITS, canonicalUnit, toBaseMeasure } from "./units.js";

/**
 * Millilitres and grams in the units the household reads (decisions §28).
 *
 * **Thresholds are a judgement, not a conversion.** A cook writes "500 g", never "0.5 kg", and
 * "250 ml", never "0.25 l" — so metric switches to the larger unit only at 1000, and stays whole
 * below it. The US side keeps its own boundaries: cups from 115 ml because half a cup is still
 * cups, and ounces from 25 g because anything less is a spoonful of spice.
 *
 * Metric shows a decimal where US shows a fraction: "1.5 kg" is how it is written down, while
 * "1½ cup" is how a cup is spoken. Below a litre or a kilo, metric rounds to whole units —
 * nobody buys 247 ml.
 *
 * Very small metric volumes stay in millilitres rather than becoming teaspoons. On a shopping
 * list these are totals, not instructions, and "15 ml" is unambiguous where "1 tbsp" invites the
 * question of whose tablespoon.
 */
export function formatVolume(ml: number, system: MeasurementSystem = "us"): string {
  if (system === "metric") {
    if (ml >= 1000) return `${decimal(ml / 1000)} l`;
    return `${Math.round(ml)} ml`;
  }
  if (ml >= UNITS.gallon!.toBase * 0.9) return `${formatQuantity(ml / UNITS.gallon!.toBase)} gal`;
  if (ml >= UNITS.quart!.toBase * 0.9) return `${formatQuantity(ml / UNITS.quart!.toBase)} qt`;
  if (ml >= 115) return `${formatQuantity(ml / UNITS.cup!.toBase)} cup`;
  if (ml >= UNITS.tbsp!.toBase * 0.9) return `${formatQuantity(ml / UNITS.tbsp!.toBase)} tbsp`;
  return `${formatQuantity(ml / UNITS.tsp!.toBase)} tsp`;
}

export function formatWeight(g: number, system: MeasurementSystem = "us"): string {
  if (system === "metric") {
    if (g >= 1000) return `${decimal(g / 1000)} kg`;
    return `${Math.round(g)} g`;
  }
  if (g >= UNITS.lb!.toBase * 0.9) return `${formatQuantity(g / UNITS.lb!.toBase)} lb`;
  if (g >= 25) return `${Math.round(g / UNITS.oz!.toBase)} oz`;
  return `${Math.round(g)} g`;
}

/** One decimal place at most, and no trailing zero: 1.5, 2, 1.2. */
function decimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

const COUNTABLE: Partial<Record<Dimension, [string, string]>> = {
  clove: ["clove", "cloves"],
  can: ["can", "cans"],
  bunch: ["bunch", "bunches"],
};

export function formatMeasure(
  amount: number,
  dimension: Dimension,
  system: MeasurementSystem = "us",
): string {
  if (dimension === "volume") return formatVolume(amount, system);
  if (dimension === "weight") return formatWeight(amount, system);
  const words = COUNTABLE[dimension];
  if (words) {
    const rounded = Math.round(amount * 100) / 100;
    return `${formatQuantity(amount)} ${rounded === 1 ? words[0] : words[1]}`;
  }
  return formatQuantity(amount);
}

/**
 * The amount as the recipe stated it, e.g. `1½ cups` or `3`.
 *
 * **"As written" means the parse, not the source text** (decisions §29). It cannot mean the
 * source text, because nothing stores it: `recipe_ingredients` keeps the amount, the unit and the
 * item, and the original keystrokes are gone by the time anything is displayed. So this renders
 * the parse the way a recipe would have written it, which is the honest reading — and the split
 * display is where somebody checks which meal takes what, so it has to read like their recipe.
 *
 * Word units inflect (`2 cloves`, `1½ cups`); symbols never do (`250 g`, `2 tbsp`). Every plural
 * emitted here is one `canonicalUnit` accepts, because the recipe editor rebuilds its lines from
 * these strings and re-parses them — a plural this produced but the parser could not read would
 * quietly lose a unit on the next save.
 */
const PLURALISABLE_UNITS = new Set(["cup", "pint", "quart", "gallon", "stick", "clove", "can", "bunch"]);

export function formatAsWritten(amount: number | null, unit: string | null): string {
  const qty = formatQuantity(amount);
  if (!unit || unit === "count") return qty;
  const word = amount !== null && amount !== 1 && PLURALISABLE_UNITS.has(unit) ? pluralise(unit) : unit;
  return qty ? `${qty} ${word}` : word;
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

/**
 * Units that belong to a market, for deciding whether a line needs converting at all.
 *
 * Counts, cloves, cans and bunches are in neither: three onions are three onions anywhere.
 */
const US_UNITS = new Set(["cup", "pint", "quart", "gallon", "tbsp", "tsp", "oz", "lb", "stick"]);
const METRIC_UNITS = new Set(["ml", "l", "g", "kg"]);

/**
 * A quantity in the units the household reads (decisions §47).
 *
 * **Only converts when the recipe's unit belongs to the other market.** A US household reading a
 * US recipe gets exactly what `formatAsWritten` gives, byte for byte — which is not a nicety.
 * `formatVolume` picks a unit by magnitude, so a blanket round trip would turn `1 pint cream` into
 * `2 cup cream` on the page of somebody who never asked for anything to change. Conversion is for
 * the lines that would otherwise need doing in somebody's head.
 *
 * Read-only surfaces use this. Editing surfaces must not (§47): the recipe editor and the import
 * review screen re-parse what they display, so converting there would rewrite the stored recipe
 * on the next save.
 */
export function formatInSystem(
  amount: number | null,
  unit: string | null,
  system: MeasurementSystem = "us",
): string {
  const canonical = canonicalUnit(unit);
  if (amount === null || canonical === null) return formatAsWritten(amount, unit);

  const written = US_UNITS.has(canonical) ? "us" : METRIC_UNITS.has(canonical) ? "metric" : null;
  if (written === null || written === system) return formatAsWritten(amount, unit);

  const measure = toBaseMeasure(amount, canonical, null);
  if (!measure || (measure.dimension !== "volume" && measure.dimension !== "weight")) {
    return formatAsWritten(amount, unit);
  }
  return formatMeasure(measure.amount, measure.dimension, system);
}

/**
 * Drop decoration from the *start* of a step, for display only.
 *
 * A caption whose every instruction begins `💕Start by seasoning…` is using the emoji as a
 * bullet. Cook mode should not show it before every line, and neither should the recipe page.
 *
 * **Stored text is untouched.** The same reasoning that keeps a source's `fresh fill` typo as
 * written: what the source said is the record, and a leading emoji is presentation. Strip at
 * render, so the decision is reversible and the original is never lost.
 *
 * **Leading only.** A mid-sentence emoji may be carrying real meaning — "🔥 high heat", or a
 * chilli marking a spicy variation — and removing it would be editing the method rather than
 * formatting it. So this anchors at the start, takes any run of decoration and the whitespace
 * after it, and stops at the first character that could be words.
 */
const LEADING_DECORATION =
  /^(?:[\s‍️•▪●□▸‣⁃∙*+·–—-]|\p{Extended_Pictographic})+/u;

export function stripLeadingDecoration(step: string): string {
  const text = String(step ?? "");
  const stripped = text.replace(LEADING_DECORATION, "");
  // a step that is *only* decoration keeps its text rather than becoming empty
  return stripped.trim() === "" ? text.trim() : stripped;
}
