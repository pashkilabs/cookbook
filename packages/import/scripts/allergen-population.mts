/**
 * What the allergen filter actually does to this household's library (§71).
 *
 * The question before any screen exists: for a common allergen, how many of the recipes resolve
 * **CLEAR**, **UNKNOWN** and **EXCLUDED**? If most land UNKNOWN the filter is a warning generator
 * rather than a filter, and the design needs to know that before anybody builds a toggle for it.
 *
 * **The two causes of UNKNOWN are reported apart**, because they are different problems with
 * different fixes:
 *
 *   a jar        a compound product whose interior an ingredient list cannot name. Irreducible —
 *                no catalog work fixes it, and §71 says so loudly.
 *   not in our   a line the catalog could not resolve. Fixable by adding catalog entries, and
 *   catalog      conflating it with the jar case would make an irreducible limit look like a
 *                backlog, or the reverse.
 *
 * Reads only, no model calls, no writes. Needs `pnpm --filter @pashki/import gen:corpus` first.
 */
import { readFileSync } from "node:fs";
import { ALLERGENS, createCatalog, isStaple, readAllergen, type Allergen } from "../../core/src/index.js";
import { catalogItemsFromRows } from "../../db/src/catalog.js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("COULD NOT MEASURE: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY needed.");
  process.exit(2);
}

type Recipe = {
  id: string;
  title: string;
  recipe_ingredients: Array<{ amount: number | null; unit: string | null; item_text: string }>;
};
let corpus: Recipe[];
try {
  corpus = JSON.parse(readFileSync("/tmp/clean.json", "utf8")) as Recipe[];
} catch {
  console.error("COULD NOT MEASURE: /tmp/clean.json missing — run gen:corpus first.");
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

const { INGREDIENT_COLUMNS, GROCERY_PACKAGE_COLUMNS } = await import("../../db/src/catalog.js");
const catalog = createCatalog(
  catalogItemsFromRows(
    (await get(`ingredients?select=${INGREDIENT_COLUMNS}`)) as never,
    (await get(`grocery_packages?select=${GROCERY_PACKAGE_COLUMNS}`)) as never,
    "us",
  ),
);

const recipes = corpus.filter((r) => (r.recipe_ingredients ?? []).length > 0);
console.log(`${recipes.length} recipes with ingredients (of ${corpus.length})\n`);

const WANTED: readonly Allergen[] = ALLERGENS;
const pad = (n: number) => String(n).padStart(3);
const jarCounts = new Map<string, number>();

console.log("                 ──── compound products only ────   ──── and unresolved lines ────");
console.log("allergen          CLEAR  UNKNOWN  EXCLUDED           CLEAR  UNKNOWN  EXCLUDED");
for (const allergen of WANTED) {
  const tally = { clear: 0, unknown: 0, excluded: 0 };
  const withCatalog = { clear: 0, unknown: 0, excluded: 0 };
  for (const recipe of recipes) {
    const lines = (recipe.recipe_ingredients ?? []).map((row) =>
      [row.amount ?? "", row.unit ?? "", row.item_text ?? ""].join(" ").trim(),
    );
    // jars only — the irreducible half
    const bare = readAllergen(lines, allergen);
    tally[bare.verdict] += 1;
    // counted on one allergen only: the same jar is opaque for all nine, and summing across them
    // multiplied every figure by about nine in the first run
    if (allergen === WANTED[0]) {
      for (const line of bare.opaque) jarCounts.set(line, (jarCounts.get(line) ?? 0) + 1);
    }

    // plus the lines our catalog cannot resolve — the fixable half
    /*
     * Staples are excluded before this counts as "unresolved".
     *
     * The first run reported `salt` 30 times and `pepper` 7 as lines the catalog could not
     * resolve, which made almost every recipe UNKNOWN. They are **deliberately absent**: this is
     * a *grocery* catalog and nobody buys salt. Counting a deliberate omission as a gap in
     * knowledge is the measurement inventing a problem — and it would have made an irreducible
     * limit look like a catalog backlog, which is the exact conflation this script exists to
     * avoid.
     */
    const unrecognised = (recipe.recipe_ingredients ?? [])
      .filter((row) => {
        const text = row.item_text ?? "";
        return text.trim().length > 0 && !isStaple(text) && !catalog.find(text);
      })
      .map((row) => row.item_text ?? "");
    withCatalog[readAllergen(lines, allergen, { unrecognised }).verdict] += 1;
  }
  console.log(
    `${allergen.padEnd(16)} ${pad(tally.clear)}     ${pad(tally.unknown)}      ${pad(tally.excluded)}` +
      `              ${pad(withCatalog.clear)}     ${pad(withCatalog.unknown)}      ${pad(withCatalog.excluded)}`,
  );
}

console.log(`\nthe jars driving UNKNOWN, most common first:`);
for (const [line, times] of [...jarCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(times).padStart(3)}×  ${line.slice(0, 64)}`);
}

const unresolved = new Map<string, number>();
for (const recipe of recipes) {
  for (const row of recipe.recipe_ingredients ?? []) {
    const text = row.item_text ?? "";
    if (text && !isStaple(text) && !catalog.find(text)) {
      unresolved.set(text, (unresolved.get(text) ?? 0) + 1);
    }
  }
}
console.log(`\n${unresolved.size} distinct ingredient texts the catalog cannot resolve; most common:`);
for (const [text, times] of [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(times).padStart(3)}×  ${text.slice(0, 64)}`);
}
