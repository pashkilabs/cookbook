import type { CatalogItem, Dimension, Measure, UnitDef } from "./types.js";

export const UNITS: Record<string, UnitDef> = {
  // volume -> ml
  tsp: { dimension: "volume", toBase: 4.92892 },
  tbsp: { dimension: "volume", toBase: 14.7868 },
  cup: { dimension: "volume", toBase: 236.588 },
  floz: { dimension: "volume", toBase: 29.5735 },
  pint: { dimension: "volume", toBase: 473.176 },
  quart: { dimension: "volume", toBase: 946.353 },
  gallon: { dimension: "volume", toBase: 3785.41 },
  ml: { dimension: "volume", toBase: 1 },
  l: { dimension: "volume", toBase: 1000 },
  // weight -> g
  g: { dimension: "weight", toBase: 1 },
  kg: { dimension: "weight", toBase: 1000 },
  oz: { dimension: "weight", toBase: 28.3495 },
  lb: { dimension: "weight", toBase: 453.592 },
  stick: { dimension: "weight", toBase: 113.4 },
  // countable
  count: { dimension: "count", toBase: 1 },
  clove: { dimension: "clove", toBase: 1 },
  can: { dimension: "can", toBase: 1 },
  jar: { dimension: "can", toBase: 1 }, package: { dimension: "can", toBase: 1 },
  box: { dimension: "can", toBase: 1 }, bag: { dimension: "can", toBase: 1 },
  container: { dimension: "can", toBase: 1 }, bottle: { dimension: "can", toBase: 1 },
  tub: { dimension: "can", toBase: 1 }, tin: { dimension: "can", toBase: 1 },
  block: { dimension: "can", toBase: 1 }, carton: { dimension: "can", toBase: 1 },
  pouch: { dimension: "can", toBase: 1 }, packet: { dimension: "can", toBase: 1 },
  bunch: { dimension: "bunch", toBase: 1 },
};

/** Spellings that map onto a real unit. */
const UNIT_ALIASES: Record<string, string> = {
  t: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbs: "tbsp", tbsps: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  c: "cup", cups: "cup",
  "fl oz": "floz", floz: "floz", "fluid ounce": "floz", "fluid ounces": "floz",
  pt: "pint", pints: "pint",
  qt: "quart", quarts: "quart",
  gal: "gallon", gallons: "gallon",
  milliliter: "ml", millilitre: "ml", milliliters: "ml", millilitres: "ml",
  liter: "l", litre: "l", liters: "l", litres: "l",
  gram: "g", grams: "g", gr: "g", gm: "g",
  kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg",
  ounce: "oz", ounces: "oz",
  lbs: "lb", pound: "lb", pounds: "lb",
  sticks: "stick",
  cloves: "clove",
  cans: "can", tin: "can", tins: "can",
  bunches: "bunch",
};

/**
 * Words that mean "one whole thing". Consumed by the parser so that
 * "1 large onion" yields a count of one, with "onion" as the item.
 */
export const COUNT_WORDS = new Set([
  "each", "whole", "large", "medium", "small", "extra-large", "jumbo",
  "head", "heads", "slice", "slices", "stalk", "stalks", "sprig", "sprigs",
  "piece", "pieces", "rib", "ribs", "ear", "ears", "fillet", "fillets",
  "breast", "breasts", "thigh", "thighs", "leaf", "leaves",
]);

/**
 * Containers whose contents are usually printed on the tin. When the line
 * gives a size — "1 (14.5 oz) can" — we convert to that real measure.
 */
/** plural and abbreviation to the written singular — "packages" and "pkg" are both "package" */
export const CONTAINER_SINGULAR: Record<string, string> = {
  cans: "can", jars: "jar", packages: "package", pkg: "package", pkgs: "package",
  boxes: "box", bags: "bag", containers: "container", bottles: "bottle", tubs: "tub",
  tins: "tin", blocks: "block", cartons: "carton", pouches: "pouch", packets: "packet",
};

/** the container word this unit is, or null — `canonicalUnit` keeps the word rather than
 * flattening every container to "can", because the word is what gets displayed and what a
 * per-ingredient size is keyed on */
export function containerWord(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const k = String(unit).trim().toLowerCase().replace(/\.$/, "");
  const singular = CONTAINER_SINGULAR[k] ?? k;
  return CONTAINER_WORDS.has(k) || CONTAINER_WORDS.has(singular) ? singular : null;
}

export const CONTAINER_WORDS = new Set([
  "can", "cans", "jar", "jars", "package", "packages", "pkg", "pkgs",
  "box", "boxes", "bag", "bags", "container", "containers", "bottle",
  "bottles", "tub", "tubs", "tin", "tins", "block", "blocks",
  "carton", "cartons", "pouch", "pouches", "packet", "packets",
]);

/** Resolve a written unit to its canonical key, or null if it isn't one. */
export function canonicalUnit(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim().replace(/\.$/, "");
  // Long-standing recipe convention, and the one place capitals matter.
  if (trimmed === "T") return "tbsp";
  if (trimmed === "t") return "tsp";
  const k = trimmed.toLowerCase();
  if (!k) return null;
  if (UNITS[k]) return k;
  const alias = UNIT_ALIASES[k];
  if (alias) return alias;
  if (COUNT_WORDS.has(k)) return "count";
  // the written word survives — "package" stays "package", not "can"
  const container = containerWord(k);
  if (container) return container;
  return null;
}

export function isUnitWord(word: string): boolean {
  return canonicalUnit(word) !== null;
}

/**
 * Convert a stated quantity into a base measure, using what the catalog knows
 * about the item to bridge dimensions where possible:
 *   "1 can black beans"  -> 425 g   (canSize)
 *   "1 cup flour"        -> 125 g   (gramsPerCup, because flour is sold by weight)
 */
export function toBaseMeasure(
  amount: number | null,
  unit: string | null,
  item?: CatalogItem | null,
): Measure | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const key = unit ?? "count";
  const def = UNITS[key];
  if (!def) return null;

  let dimension: Dimension = def.dimension;
  let value = amount * def.toBase;

  /*
   * A container resolves to a weight only when *this ingredient* says what that container
   * holds. `containers` is checked first and `canSize` is the "can" entry kept for compatibility;
   * where neither answers, the measure stays a count of containers, which is what a shopping
   * list can actually buy.
   */
  if (item && dimension === "can") {
    const word = containerWord(key);
    const size = (word ? item.containers?.[word] : undefined) ?? (word === "can" ? item.canSize : undefined);
    if (size) {
      value *= size;
      dimension = item.dimension;
    }
  }
  if (item && item.gramsPerCup && dimension === "volume" && item.dimension === "weight") {
    value = (value / UNITS.cup!.toBase) * item.gramsPerCup;
    dimension = "weight";
  }
  return { amount: value, dimension };
}
