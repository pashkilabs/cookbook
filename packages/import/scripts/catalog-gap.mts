/**
 * What the catalog gap costs the shopping list — which is where it costs money (§71).
 *
 * Separated from the allergen measurement on purpose. There, catalog absence was being used as
 * evidence that an ingredient could not be reasoned about, which was a category error: the
 * catalog's job is *buying*, and it lacking `dried oregano` means it has no package size for
 * oregano, not that nobody knows what oregano is. Unwiring it took CLEAR from 10 back to 76 of 82.
 *
 * But the gap is real, and here is where it bites. Three costs, and the first guess was wrong:
 *
 *   consolidation   NOT lost. `consolidate` keys on `item.key` when the catalog resolves and on
 *                   `normaliseName(text)` when it does not, so two recipes writing the same words
 *                   still add up. The loss is narrower than "ingredients do not consolidate".
 *   synonyms        lost. `scallions` and `spring onions` are one ingredient and two keys without
 *                   the catalog's alias list, so they sit as two lines and are bought twice.
 *   package maths   lost. No `grocery_packages` row means no pint-against-500-ml decision, so the
 *                   founding example of this product — one pint split across Tuesday and Friday
 *                   rather than two half-pints and waste — cannot run on that line.
 *   aisle           lost. `aisleFor` has nothing, so the line does not group where you walk.
 */
import { readFileSync } from "node:fs";
import { createCatalog, isStaple, normaliseName } from "../../core/src/index.js";
import { catalogItemsFromRows, INGREDIENT_COLUMNS, GROCERY_PACKAGE_COLUMNS } from "../../db/src/catalog.js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("COULD NOT MEASURE: Supabase url and service role needed.");
  process.exit(2);
}
const get = async (path: string) => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    console.error(`COULD NOT MEASURE: ${path} came back ${response.status}`);
    process.exit(2);
  }
  return (await response.json()) as unknown[];
};

type Recipe = { id: string; title: string; recipe_ingredients: Array<{ item_text: string }> };
let corpus: Recipe[];
try {
  corpus = JSON.parse(readFileSync("/tmp/clean.json", "utf8")) as Recipe[];
} catch {
  console.error("COULD NOT MEASURE: /tmp/clean.json missing — run gen:corpus first.");
  process.exit(2);
}

const catalog = createCatalog(
  catalogItemsFromRows(
    (await get(`ingredients?select=${INGREDIENT_COLUMNS}`)) as never,
    (await get(`grocery_packages?select=${GROCERY_PACKAGE_COLUMNS}`)) as never,
    "us",
  ),
);

let rows = 0, staples = 0, resolved = 0;
const unresolved = new Map<string, Set<string>>();
const resolvedNoPackage = new Map<string, number>();

for (const recipe of corpus) {
  for (const line of recipe.recipe_ingredients ?? []) {
    const text = (line.item_text ?? "").trim();
    if (!text) continue;
    rows += 1;
    if (isStaple(text)) { staples += 1; continue; }
    const item = catalog.find(text);
    if (item) {
      resolved += 1;
      // resolved but with no package row is the same package-maths loss, via a different route
      if (!item.packages || item.packages.length === 0) {
        resolvedNoPackage.set(item.key, (resolvedNoPackage.get(item.key) ?? 0) + 1);
      }
      continue;
    }
    const norm = normaliseName(text) || text;
    if (!unresolved.has(norm)) unresolved.set(norm, new Set());
    unresolved.get(norm)!.add(recipe.id);
  }
}

const buyable = rows - staples;
const unresolvedRows = [...unresolved.values()].reduce((sum, set) => sum + set.size, 0);
const shared = [...unresolved.entries()].filter(([, recipes]) => recipes.size >= 2);

console.log(`${corpus.length} recipes, ${rows} ingredient rows`);
console.log(`  ${staples} staples (not bought)`);
console.log(`  ${resolved} of ${buyable} buyable rows resolve to a catalog item  (${Math.round(resolved / buyable * 100)}%)`);
console.log(`  ${unresolvedRows} do not, across ${unresolved.size} distinct names`);
console.log("");
console.log(`what the gap costs, measured:`);
console.log(`  ${shared.length} of the ${unresolved.size} unresolved names appear in TWO OR MORE recipes.`);
console.log(`    those still consolidate by written text — the loss is package maths and aisle, not addition.`);
console.log(`  ${resolvedNoPackage.size} names DO resolve but carry no package row, so they lose package maths too.`);
console.log("");
console.log(`unresolved and shared across recipes, most-used first — the lines a pass would fix:`);
for (const [name, recipes] of shared.sort((a, b) => b[1].size - a[1].size).slice(0, 20)) {
  console.log(`  ${String(recipes.size).padStart(3)} recipes  ${name.slice(0, 54)}`);
}
