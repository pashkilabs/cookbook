/**
 * Generate supabase/seed.sql from SEED_CATALOG.
 *
 *   pnpm --filter @pashki/db gen:seed
 *
 * Never hand-edit the output. A hand-copy of 55 items with their package lists
 * drifts from the source the first time someone corrects a gram-per-cup figure in
 * one place and not the other, and a drifted seed is worse than no seed: the
 * round-trip test would still be comparing the database against itself.
 *
 * This is one of the two places allowed to import SEED_CATALOG — seeding and
 * tests. `scripts/check-seed-catalog-usage.mjs` enforces that.
 */
import { writeFileSync } from "node:fs";
import { METRIC_PACKAGES, SEED_CATALOG } from "@pashki/core";

/** Single-quoted SQL literal. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** A Postgres text[] literal, e.g. array['heavy cream','double cream']. */
const textArray = (values: string[]): string =>
  values.length === 0 ? `'{}'::text[]` : `array[${values.map(lit).join(", ")}]`;

const num = (value: number | undefined): string => (value === undefined ? "null" : String(value));

/** A text literal that may be absent — most items carry no FDC id yet, and that is the point. */
const litOrNull = (value: string | undefined): string => (value === undefined ? "null" : lit(value));

const rows: string[] = [];
const packageRows: string[] = [];
const containerRows: string[] = [];

for (const item of SEED_CATALOG) {
  const [canonical, ...aliases] = item.names;
  if (!canonical) throw new Error(`catalog item ${item.key} has no names`);

  rows.push(
    `  (${lit(item.key)}, ${lit(canonical)}, ${textArray(aliases)}, ` +
      `${lit(item.aisle)}, ${lit(item.dimension)}, ${num(item.gramsPerCup)}, ${num(item.canSize)}, ` +
      `${num(item.gramsEach)}, ${num(item.kcalPer100g)}, ${litOrNull(item.energyFdcId)})`,
  );

  // sort_order preserves the order the catalog lists packages in, which is the
  // order a shopping list offers them.
  //
  // Both markets are emitted. Sizes differ by market rather than only in their wording, so these
  // are separate rows and a list must never mix them (decisions §28). Metric coverage is partial
  // and the uncovered items simply have no metric rows — `catalogItemsFromRows` falls back to the
  // US ones explicitly rather than leaving an item unbuyable.
  item.packages.forEach((size, index) => {
    packageRows.push(
      `  (${lit(item.key)}, ${lit("us")}, ${lit(size.label)}, ${size.amount}, ${index})`,
    );
  });
  /*
   * Container sizes, where this ingredient has one. Almost nothing does, and that is the design:
   * a size is asserted only where it is standard across brands — a yeast packet is 7 g — because
   * a default per container word prints a confidently wrong weight on old family recipes.
   */
  for (const [word, amount] of Object.entries(item.containers ?? {})) {
    containerRows.push(`  (${lit(item.key)}, ${lit(word)}, ${amount})`);
  }

  (METRIC_PACKAGES[item.key] ?? []).forEach((size, index) => {
    packageRows.push(
      `  (${lit(item.key)}, ${lit("metric")}, ${lit(size.label)}, ${size.amount}, ${index})`,
    );
  });
}

const sql = `-- GENERATED FILE — do not edit.
--
-- Written by scripts/generate-seed.ts from SEED_CATALOG in @pashki/core.
-- Regenerate with: pnpm --filter @pashki/db gen:seed
--
-- ${SEED_CATALOG.length} ingredients, ${packageRows.length} package sizes, ${containerRows.length} container sizes.
--
-- Idempotent: \`supabase db reset\` runs this after the migrations, and running it
-- again upserts rather than duplicating. Both tables have the unique constraints
-- that makes that possible — ingredients.key and (ingredient_id, system, label).
--
-- base_amount and can_size are in the dimension's base unit, millilitres or
-- grams. grams_per_cup is what lets a volume measure merge into an item sold by
-- weight. Never do arithmetic on written units.

begin;

-- Park every canonical name this run is about to write.
--
-- Splitting an entry moves a name from an old row to a new one, and both are in the same
-- statement: \`mozzarella\` claims "shredded mozzarella" while \`shredded-cheese\` still holds it.
-- Unique constraints are checked row by row rather than at commit, so the insert fails against
-- any database that already has the old row — and never against a local \`db reset\`, which
-- builds from nothing and so cannot collide. Local green was not evidence; the hosted push
-- refused itself with \`ingredients_canonical_name_unique\`.
--
-- Scoped to the keys below so a row present in the database but absent from SEED_CATALOG keeps
-- its name rather than being stranded under a parked one.
update public.ingredients
set canonical_name = 'seed:parking:' || key
where key in (${SEED_CATALOG.map((item) => `'${item.key.replace(/'/g, "''")}'`).join(", ")});

insert into public.ingredients
  (key, canonical_name, aliases, aisle, dimension, grams_per_cup, can_size,
   grams_each, kcal_per_100g, energy_fdc_id)
values
${rows.join(",\n")}
on conflict (key) do update set
  canonical_name = excluded.canonical_name,
  aliases        = excluded.aliases,
  aisle          = excluded.aisle,
  dimension      = excluded.dimension,
  grams_per_cup  = excluded.grams_per_cup,
  grams_each     = excluded.grams_each,
  kcal_per_100g  = excluded.kcal_per_100g,
  energy_fdc_id  = excluded.energy_fdc_id,
  can_size       = excluded.can_size,
  updated_at     = now();

-- Packages are keyed to their ingredient by catalog key rather than by a uuid, so
-- this file carries no generated ids and stays stable between runs.
insert into public.grocery_packages (ingredient_id, system, label, base_amount, sort_order)
select i.id, seed.system, seed.label, seed.base_amount, seed.sort_order
from (values
${packageRows.join(",\n")}
) as seed(ingredient_key, system, label, base_amount, sort_order)
join public.ingredients i on i.key = seed.ingredient_key
on conflict (ingredient_id, system, label) do update set
  base_amount = excluded.base_amount,
  sort_order  = excluded.sort_order,
  updated_at  = now();

insert into public.ingredient_containers (ingredient_id, word, base_amount)
select i.id, seed.word, seed.base_amount
from (values
${containerRows.join(",\n")}
) as seed(ingredient_key, word, base_amount)
join public.ingredients i on i.key = seed.ingredient_key
on conflict (ingredient_id, word) do update set
  base_amount = excluded.base_amount,
  updated_at  = now();

delete from public.ingredient_containers ic
using public.ingredients i
where ic.ingredient_id = i.id
  and (i.key, ic.word) not in (
    select seed.ingredient_key, seed.word
    from (values
${containerRows.join(",\n")}
    ) as seed(ingredient_key, word, base_amount)
  );

-- A package list that shrank in SEED_CATALOG must shrink here too, or the catalog
-- would keep offering a size that no longer exists. Anything not in this run's
-- values list is removed.
delete from public.grocery_packages gp
using public.ingredients i
where gp.ingredient_id = i.id
  and (i.key, gp.system, gp.label) not in (
    select seed.ingredient_key, seed.system, seed.label
    from (values
${packageRows.join(",\n")}
    ) as seed(ingredient_key, system, label, base_amount, sort_order)
  );

commit;
`;

const out = new URL("../supabase/seed.sql", import.meta.url);
writeFileSync(out, sql);
console.log(
  `wrote ${SEED_CATALOG.length} ingredients and ${packageRows.length} packages to supabase/seed.sql`,
);
