import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  consolidate,
  createCatalog,
  parseIngredientList,
  SEED_CATALOG,
  type Catalog,
  type CatalogItem,
  type ConsolidationEntry,
} from "@pashki/core";
import { AISLE_PROBES, KNOWN_WEEK, MATCH_PROBES } from "@pashki/core/test-fixtures";
import { readLocalInstance } from "./local-instance.js";

/**
 * The catalog survives the round trip through Postgres.
 *
 * `grams_per_cup` and `can_size` exist for this: without them a volume measure
 * could not merge into a weight-sold item and a bare tin would come back as a
 * count, so the seeded catalog would consolidate differently from the source even
 * though every row looked plausible.
 *
 * Comparison is on behaviour, not on rows. Two catalogs with identical rows in a
 * different order still pick different packages, and rows are what a hand-written
 * seed would get right while behaviour drifted.
 */
const instance = readLocalInstance();

/** Rebuild CatalogItem[] from the database, exactly as production will. */
async function loadCatalogFromDatabase(admin: SupabaseClient): Promise<CatalogItem[]> {
  const ingredients = await admin
    .from("ingredients")
    .select("id, key, canonical_name, aliases, aisle, dimension, grams_per_cup, can_size");
  if (ingredients.error) throw ingredients.error;

  const packages = await admin
    .from("grocery_packages")
    .select("ingredient_id, label, base_amount, sort_order");
  if (packages.error) throw packages.error;

  const byIngredient = new Map<string, Array<{ label: string; amount: number; sort: number }>>();
  for (const row of packages.data) {
    const list = byIngredient.get(row.ingredient_id) ?? [];
    list.push({
      label: row.label,
      amount: Number(row.base_amount),
      sort: row.sort_order,
    });
    byIngredient.set(row.ingredient_id, list);
  }

  return ingredients.data.map((row) => ({
    key: row.key,
    // canonical name first, then aliases — the order createCatalog matches on
    names: [row.canonical_name, ...row.aliases],
    aisle: row.aisle,
    dimension: row.dimension as CatalogItem["dimension"],
    packages: byIngredient
      .get(row.id)
      ?.sort((a, b) => a.sort - b.sort)
      .map(({ label, amount }) => ({ label, amount })) ?? [],
    ...(row.grams_per_cup === null ? {} : { gramsPerCup: Number(row.grams_per_cup) }),
    ...(row.can_size === null ? {} : { canSize: Number(row.can_size) }),
  }));
}

const week = (): ConsolidationEntry[] =>
  KNOWN_WEEK.map((entry) => ({
    label: entry.label,
    ingredients: parseIngredientList(entry.lines),
    ...(entry.scale === undefined ? {} : { scale: entry.scale }),
  }));

describe.skipIf(instance === null)("seeded catalog round-trip", () => {
  const fromSeed = createCatalog(SEED_CATALOG);
  let fromDatabase: Catalog;
  let loaded: CatalogItem[];

  beforeAll(async () => {
    if (!instance) return;
    const admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    loaded = await loadCatalogFromDatabase(admin);
    fromDatabase = createCatalog(loaded);
  });

  it("seeds every catalog item exactly once", () => {
    expect(loaded).toHaveLength(SEED_CATALOG.length);
    expect(new Set(loaded.map((i) => i.key)).size).toBe(SEED_CATALOG.length);
  });

  it("reconstructs every item identically, field for field", () => {
    const sort = (items: CatalogItem[]): CatalogItem[] =>
      [...items].sort((a, b) => a.key.localeCompare(b.key));
    expect(sort(loaded)).toEqual(sort(SEED_CATALOG));
  });

  it("carries grams_per_cup and can_size, the fields this task exists for", () => {
    const withGrams = SEED_CATALOG.filter((i) => i.gramsPerCup !== undefined);
    const withCans = SEED_CATALOG.filter((i) => i.canSize !== undefined);
    // guard the guard: if these ever hit zero the assertions below prove nothing
    expect(withGrams.length).toBeGreaterThan(0);
    expect(withCans.length).toBeGreaterThan(0);

    for (const item of withGrams) {
      expect(fromDatabase.find(item.names[0]!)?.gramsPerCup, item.key).toBe(item.gramsPerCup);
    }
    for (const item of withCans) {
      expect(fromDatabase.find(item.names[0]!)?.canSize, item.key).toBe(item.canSize);
    }
  });

  it("matches the same names to the same keys", () => {
    for (const [name, key] of MATCH_PROBES) {
      expect(fromDatabase.find(name)?.key ?? null, name).toBe(key);
      expect(fromDatabase.find(name)?.key ?? null, name).toBe(fromSeed.find(name)?.key ?? null);
    }
  });

  it("resolves the same aisles, including keyword fallbacks", () => {
    for (const [name, aisle] of AISLE_PROBES) {
      expect(fromDatabase.aisleFor(name), name).toBe(aisle);
    }
    for (const item of SEED_CATALOG) {
      const name = item.names[0]!;
      expect(fromDatabase.aisleFor(name), name).toBe(fromSeed.aisleFor(name));
    }
  });

  it("offers package sizes in the same order", () => {
    for (const item of SEED_CATALOG) {
      const found = fromDatabase.find(item.names[0]!);
      expect(found?.packages, item.key).toEqual(item.packages);
    }
  });

  it("produces a byte-identical shopping list for a known week", () => {
    // the real assertion: every package choice, split, leftover and aisle order
    // over a week that touches every dimension the catalog carries
    expect(consolidate(week(), fromDatabase)).toEqual(consolidate(week(), fromSeed));
  });

  it("produces the same list with pantry deduction and staples kept", () => {
    const options = {
      pantry: [{ name: "heavy cream", amount: 1, unit: "cup" }],
      deductPantry: true,
      excludeStaples: false,
    };
    expect(consolidate(week(), fromDatabase, options)).toEqual(
      consolidate(week(), fromSeed, options),
    );
  });
});

describe.skipIf(instance !== null)("seeded catalog round-trip (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
