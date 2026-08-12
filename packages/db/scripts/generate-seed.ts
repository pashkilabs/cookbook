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
import { SEED_CATALOG } from "@pashki/core";

/** Single-quoted SQL literal. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** A Postgres text[] literal, e.g. array['heavy cream','double cream']. */
const textArray = (values: string[]): string =>
  values.length === 0 ? `'{}'::text[]` : `array[${values.map(lit).join(", ")}]`;

const num = (value: number | undefined): string => (value === undefined ? "null" : String(value));

const rows: string[] = [];
const packageRows: string[] = [];

for (const item of SEED_CATALOG) {
  const [canonical, ...aliases] = item.names;
  if (!canonical) throw new Error(`catalog item ${item.key} has no names`);

  rows.push(
    `  (${lit(item.key)}, ${lit(canonical)}, ${textArray(aliases)}, ` +
      `${lit(item.aisle)}, ${lit(item.dimension)}, ${num(item.gramsPerCup)}, ${num(item.canSize)})`,
  );

  // sort_order preserves the order the catalog lists packages in, which is the
  // order a shopping list offers them
  item.packages.forEach((size, index) => {
    packageRows.push(
      `  (${lit(item.key)}, ${lit(size.label)}, ${size.amount}, ${index})`,
    );
  });
}

const sql = `-- GENERATED FILE — do not edit.
--
-- Written by scripts/generate-seed.ts from SEED_CATALOG in @pashki/core.
-- Regenerate with: pnpm --filter @pashki/db gen:seed
--
-- ${SEED_CATALOG.length} ingredients, ${packageRows.length} package sizes.
--
-- Idempotent: \`supabase db reset\` runs this after the migrations, and running it
-- again upserts rather than duplicating. Both tables have the unique constraints
-- that makes that possible — ingredients.key and (ingredient_id, label).
--
-- base_amount and can_size are in the dimension's base unit, millilitres or
-- grams. grams_per_cup is what lets a volume measure merge into an item sold by
-- weight. Never do arithmetic on written units.

begin;

insert into public.ingredients
  (key, canonical_name, aliases, aisle, dimension, grams_per_cup, can_size)
values
${rows.join(",\n")}
on conflict (key) do update set
  canonical_name = excluded.canonical_name,
  aliases        = excluded.aliases,
  aisle          = excluded.aisle,
  dimension      = excluded.dimension,
  grams_per_cup  = excluded.grams_per_cup,
  can_size       = excluded.can_size,
  updated_at     = now();

-- Packages are keyed to their ingredient by catalog key rather than by a uuid, so
-- this file carries no generated ids and stays stable between runs.
insert into public.grocery_packages (ingredient_id, label, base_amount, sort_order)
select i.id, seed.label, seed.base_amount, seed.sort_order
from (values
${packageRows.join(",\n")}
) as seed(ingredient_key, label, base_amount, sort_order)
join public.ingredients i on i.key = seed.ingredient_key
on conflict (ingredient_id, label) do update set
  base_amount = excluded.base_amount,
  sort_order  = excluded.sort_order,
  updated_at  = now();

-- A package list that shrank in SEED_CATALOG must shrink here too, or the catalog
-- would keep offering a size that no longer exists. Anything not in this run's
-- values list is removed.
delete from public.grocery_packages gp
using public.ingredients i
where gp.ingredient_id = i.id
  and (i.key, gp.label) not in (
    select seed.ingredient_key, seed.label
    from (values
${packageRows.join(",\n")}
    ) as seed(ingredient_key, label, base_amount, sort_order)
  );

commit;
`;

const out = new URL("../supabase/seed.sql", import.meta.url);
writeFileSync(out, sql);
console.log(
  `wrote ${SEED_CATALOG.length} ingredients and ${packageRows.length} packages to supabase/seed.sql`,
);
