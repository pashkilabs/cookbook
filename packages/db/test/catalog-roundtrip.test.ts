import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { metricPackageCoverage } from "@pashki/core";
import {
  catalogItemsFromRows,
  GROCERY_PACKAGE_COLUMNS,
  INGREDIENT_COLUMNS,
  INGREDIENT_CONTAINER_COLUMNS,
} from "../src/catalog.js";
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
    .select(INGREDIENT_COLUMNS);
  if (ingredients.error) throw ingredients.error;

  const packages = await admin.from("grocery_packages").select(GROCERY_PACKAGE_COLUMNS);
  if (packages.error) throw packages.error;

  // the same mapping the app uses, so this test proves the app's catalog and not a copy of it
  const containers = await admin.from("ingredient_containers").select(INGREDIENT_CONTAINER_COLUMNS);
  if (containers.error) throw containers.error;
  return catalogItemsFromRows(ingredients.data, packages.data, "us", containers.data);
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

  describe("container sizes survive the round trip", () => {
    it("carries containers, alongside can_size, for the ingredients that have them", () => {
      const withContainers = SEED_CATALOG.filter((i) => i.containers !== undefined);
      // a check that could pass on an empty set has measured nothing
      expect(withContainers.length).toBeGreaterThan(0);

      for (const item of withContainers) {
        expect(fromDatabase.find(item.names[0]!)?.containers, item.key).toEqual(item.containers);
      }
    });

    it("gives no containers to an ingredient the catalog leaves unsized", () => {
      // the design, not an omission: a box is 13.25 oz for one brand and 15.25 for another, so
      // "1 box" stays a box rather than becoming a confidently wrong weight
      const unsized = SEED_CATALOG.filter((i) => i.containers === undefined);
      expect(unsized.length).toBeGreaterThan(0);
      expect(fromDatabase.find(unsized[0]!.names[0]!)?.containers).toBeUndefined();
    });
  });

});

describe.skipIf(instance !== null)("seeded catalog round-trip (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});

describe.skipIf(instance === null)("package sizes per market", () => {
  it("gives a metric household sizes it can buy, and falls back where it cannot", async () => {
    if (!instance) return;
    const admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const ingredients = await admin.from("ingredients").select(INGREDIENT_COLUMNS);
    const packages = await admin.from("grocery_packages").select(GROCERY_PACKAGE_COLUMNS);
    if (ingredients.error) throw ingredients.error;
    if (packages.error) throw packages.error;

    const us = catalogItemsFromRows(ingredients.data, packages.data, "us");
    const metric = catalogItemsFromRows(ingredients.data, packages.data, "metric");

    const usCream = us.find((item) => item.key === "heavy-cream")!;
    const metricCream = metric.find((item) => item.key === "heavy-cream")!;
    expect(usCream.packages.map((size) => size.label)).toContain("pint (16 oz)");
    expect(metricCream.packages.map((size) => size.label)).toEqual(["300 ml pot", "600 ml pot"]);

    // coverage is partial on purpose; an uncovered item keeps the US sizes rather than having none
    const covered = metricPackageCoverage();
    const uncovered = metric.find((item) => item.key === covered.missing[0]);
    const sameInUs = us.find((item) => item.key === covered.missing[0]);
    expect(uncovered?.packages).toEqual(sameInUs?.packages);
    expect(metric.every((item) => item.packages.length > 0)).toBe(true);
  });

  it("keeps every canonical name singular, because the display pluralises", async () => {
    if (!instance) return;
    const admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await admin.from("ingredients").select("key, canonical_name, dimension");
    // regression: the catalog held some plural and some singular, which read as "1½ lemons"
    // beside "3 yellow onion" on one list
    const plural = (data ?? []).filter(
      (row) => row.dimension === "count" && /(?<!s)s$/.test(row.canonical_name),
    );
    expect(plural.map((row) => row.canonical_name)).toEqual([]);
  });

});
