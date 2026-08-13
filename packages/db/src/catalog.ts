import type { CatalogItem, MeasurementSystem } from "@pashki/core";

/**
 * Catalog rows, as `packages/core` wants them.
 *
 * **The catalog is data, not code.** `SEED_CATALOG` is seed data for these two tables, and
 * nothing outside seeding and tests may import it — `scripts/check-seed-catalog-usage.mjs` fails
 * the build on it. So anything that needs a catalog at runtime reads the tables and comes
 * through here.
 *
 * This lives in `packages/db` because it is the row shape that is the schema's business.
 * `createCatalog()` takes it from there and knows nothing about a database, which is what lets
 * the same matcher run in Next.js, in Expo and in the worker.
 *
 * Pure: rows in, domain objects out, no client and no I/O. The caller does the reading, because
 * the caller is the one that knows which credentials it holds.
 */
export interface IngredientRow {
  id: string;
  key: string;
  canonical_name: string;
  aliases: string[];
  aisle: string;
  dimension: string;
  grams_per_cup: number | string | null;
  can_size: number | string | null;
}

export interface GroceryPackageRow {
  ingredient_id: string;
  system: string;
  label: string;
  base_amount: number | string;
  sort_order: number;
}

/** What to select, so a caller cannot ask for a column this mapper does not expect. */
export const INGREDIENT_COLUMNS =
  "id, key, canonical_name, aliases, aisle, dimension, grams_per_cup, can_size";
export const GROCERY_PACKAGE_COLUMNS = "ingredient_id, system, label, base_amount, sort_order";

/**
 * @param system which market's package sizes to use. Sizes differ by market rather than only in
 * their wording — a pint is 473 ml, a metric carton 500 — so a list must never mix them
 * (decisions §28). **Falls back to the US rows** for any item with no rows in the requested
 * system, because metric coverage is partial and an item with no packages is one a household
 * cannot be told how to buy.
 */
export function catalogItemsFromRows(
  ingredients: IngredientRow[],
  packages: GroceryPackageRow[],
  system: MeasurementSystem = "us",
): CatalogItem[] {
  const byIngredient = new Map<string, GroceryPackageRow[]>();
  const usByIngredient = new Map<string, GroceryPackageRow[]>();
  for (const row of packages) {
    if (row.system === system) {
      const list = byIngredient.get(row.ingredient_id) ?? [];
      list.push(row);
      byIngredient.set(row.ingredient_id, list);
    }
    if (row.system === "us") {
      const list = usByIngredient.get(row.ingredient_id) ?? [];
      list.push(row);
      usByIngredient.set(row.ingredient_id, list);
    }
  }

  return ingredients.map((row) => ({
    key: row.key,
    // canonical name first, then aliases — the order createCatalog matches on
    names: [row.canonical_name, ...row.aliases],
    aisle: row.aisle,
    dimension: row.dimension as CatalogItem["dimension"],
    packages:
      (byIngredient.get(row.id) ?? usByIngredient.get(row.id))
        ?.slice()
        // sort_order is the shop's order — smallest first — and choosePackages relies on it
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((size) => ({ label: size.label, amount: Number(size.base_amount) })) ?? [],
    // numerics arrive as strings over PostgREST; absent stays absent rather than becoming 0
    ...(row.grams_per_cup === null ? {} : { gramsPerCup: Number(row.grams_per_cup) }),
    ...(row.can_size === null ? {} : { canSize: Number(row.can_size) }),
  }));
}
