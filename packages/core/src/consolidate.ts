import type {
  CatalogItem, ConsolidateOptions, ConsolidationEntry, Dimension,
  IngredientUse, ShoppingLine,
} from "./types.js";
import type { Catalog } from "./catalog.js";
import { AISLE_ORDER, choosePackages } from "./catalog.js";
import { formatAsWritten, formatMeasure, formatPackages } from "./format.js";
import { isStaple, normaliseName } from "./text.js";
import { toBaseMeasure } from "./units.js";

interface Bucket {
  key: string;
  label: string;
  item: CatalogItem | null;
  aisle: string;
  uses: IngredientUse[];
  totals: Partial<Record<Dimension, number>>;
}

/**
 * Merge the ingredients of several recipes into one shopping list.
 *
 * The interesting part is the last step: for anything the catalog knows how to
 * buy, work out the smallest package that covers the total, then report how
 * that package divides across the recipes that wanted it and what's left over.
 * That leftover is what lets the planner suggest a second recipe to finish it.
 */
export function consolidate(
  entries: ConsolidationEntry[],
  catalog: Catalog,
  options: ConsolidateOptions = {},
): ShoppingLine[] {
  const { pantry = [], excludeStaples = true, deductPantry = false, system = "us" } = options;
  const buckets = new Map<string, Bucket>();

  for (const entry of entries) {
    const scale = entry.scale ?? 1;
    for (const ingredient of entry.ingredients) {
      if (!ingredient.item) continue;
      if (excludeStaples && isStaple(ingredient.item)) continue;

      const item = catalog.find(ingredient.item);
      const key = item ? item.key : normaliseName(ingredient.item) || ingredient.item;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          label: item ? item.names[0]! : normaliseName(ingredient.item) || ingredient.item,
          item,
          aisle: catalog.aisleFor(ingredient.item),
          uses: [],
          totals: {},
        };
        buckets.set(key, bucket);
      }

      const scaled = ingredient.amount == null ? null : ingredient.amount * scale;
      const measure = toBaseMeasure(scaled, ingredient.unit, item);

      bucket.uses.push({
        label: entry.label,
        ...(entry.groupKey !== undefined ? { groupKey: entry.groupKey } : {}),
        amount: measure?.amount ?? 0,
        /*
         * The household's units, not the recipe's.
         *
         * regression: this was `formatAsWritten`, which renders the parse as the recipe wrote it
         * (§29). On a shopping list that put two systems on one page — "600 ml pot" and "500 g
         * needed" beside "Tuesday takes 1 lb" — for a household that had asked for metric. A
         * shopping list is the household's document: it is read in a shop, against packages
         * priced in the household's units, and a line that needs converting in somebody's head
         * is the one thing this list exists to remove.
         *
         * `formatAsWritten` keeps its job on the recipe itself, where "as written" is the point.
         * A measure that cannot reach base units (an unknown unit) still falls back to it,
         * because a line rendered wrongly is worse than one rendered in the recipe's own words.
         */
        display: measure
          ? formatMeasure(measure.amount, measure.dimension, system)
          : formatAsWritten(scaled, ingredient.unit),
      });

      if (measure) {
        bucket.totals[measure.dimension] = (bucket.totals[measure.dimension] ?? 0) + measure.amount;
      }
    }
  }

  const pantryIndex = new Map(pantry.map((p) => [normaliseName(p.name), p]));

  const lines = [...buckets.values()].map((bucket): ShoppingLine => {
    const present = Object.keys(bucket.totals) as Dimension[];
    // Prefer the dimension the item is sold in, but only if we have an amount
    // in it — "1 can beans" with no known tin size must not report zero grams.
    const primary: Dimension =
      bucket.item && bucket.totals[bucket.item.dimension]
        ? bucket.item.dimension
        : present.sort((a, b) => (bucket.totals[b] ?? 0) - (bucket.totals[a] ?? 0))[0]
          ?? bucket.item?.dimension
          ?? "count";

    let needed = bucket.totals[primary] ?? 0;

    const onHand = pantryIndex.get(bucket.key) ?? pantryIndex.get(normaliseName(bucket.label));
    if (onHand && deductPantry && onHand.amount != null) {
      const have = toBaseMeasure(onHand.amount, onHand.unit ?? null, bucket.item);
      if (have && have.dimension === primary) needed = Math.max(0, needed - have.amount);
    }

    const sellable = bucket.item && primary === bucket.item.dimension && needed > 0;
    const packages = sellable ? choosePackages(needed, bucket.item!.packages) : null;
    const capacity = packages?.reduce((sum, p) => sum + p.size.amount * p.count, 0) ?? 0;
    const leftover = capacity > 0 ? Math.max(0, capacity - needed) : 0;

    return {
      key: bucket.key,
      label: bucket.label,
      aisle: bucket.aisle,
      dimension: primary,
      needed,
      neededDisplay: formatMeasure(needed, primary, system),
      packages,
      packagesDisplay: packages ? formatPackages(packages) : null,
      capacity,
      leftover,
      leftoverDisplay: leftover > 0 ? formatMeasure(leftover, primary, system) : null,
      uses: bucket.uses,
      inPantry: Boolean(onHand),
      otherDimensions: present
        .filter((d) => d !== primary)
        .map((d) => ({
          dimension: d,
          amount: bucket.totals[d] ?? 0,
          display: formatMeasure(bucket.totals[d] ?? 0, d, system),
        })),
    };
  });

  return lines.sort(
    (a, b) =>
      AISLE_ORDER.indexOf(a.aisle as (typeof AISLE_ORDER)[number]) -
        AISLE_ORDER.indexOf(b.aisle as (typeof AISLE_ORDER)[number]) ||
      a.label.localeCompare(b.label),
  );
}

/** Leftovers big enough to be worth planning a second recipe around. */
const WORTH_USING: Partial<Record<Dimension, number>> = {
  volume: 60, weight: 60, count: 0.9, clove: 0.9, can: 0.9, bunch: 0.9,
};

export function significantLeftovers(lines: ShoppingLine[]): ShoppingLine[] {
  return lines.filter((line) => line.leftover > (WORTH_USING[line.dimension] ?? 0.9));
}

/**
 * Which unplanned recipes would use up what's left over. This is the feature
 * that turns a shopping list into a planning aid rather than a receipt.
 */
export function recipesUsingLeftovers<T extends { ingredients: { item: string }[] }>(
  leftovers: ShoppingLine[],
  candidates: T[],
  catalog: Catalog,
): T[] {
  const wanted = new Set(leftovers.map((l) => l.key));
  if (!wanted.size) return [];
  return candidates.filter((recipe) =>
    recipe.ingredients.some((ing) => {
      const item = catalog.find(ing.item);
      return wanted.has(item ? item.key : normaliseName(ing.item));
    }),
  );
}
