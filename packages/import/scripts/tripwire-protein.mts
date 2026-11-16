/**
 * A recipe that names exactly one animal and does not say so in its `principal_protein`.
 *
 * ---------------------------------------------------------------------------
 * Why a tripwire rather than a better classifier
 * ---------------------------------------------------------------------------
 *
 * "Korean Ground Beef Bowls" was stored with a null protein for three weeks and nothing noticed.
 * The classifier was not wrong about it — it was never **asked**, because the save path skipped
 * any recipe whose course the extractor had already filled, and the backfill's family discovery
 * still gated on `classified_at`, which every insert stamps. Two gates, one of them fixed, and
 * the measurable consequence is a null.
 *
 * No model answers that question cheaply enough to ask on every row every day. A **word** does,
 * for the easy majority: a title or ingredient list naming beef and nothing else is a row whose
 * protein should not be null or chicken. That is not a classifier — it cannot read
 * "Zuppa Toscana" — and it is not meant to be. It is the check that would have fired on day one.
 *
 * ---------------------------------------------------------------------------
 * Precision over recall, deliberately, and the traps are the whole design
 * ---------------------------------------------------------------------------
 *
 * A tripwire nobody trusts gets switched off, so every rule here costs recall to buy precision:
 *
 * - **Exactly one animal, or nothing is said.** A meatball naming beef and pork is a judgement,
 *   and this does not make judgements. Two animals suppress the flag entirely.
 * - **Flavourings are not the dish.** `beef broth` in a chicken soup, `duck sauce`, `fish sauce`,
 *   `chicken bouillon cube`, `goat cheese`, `duck fat`. An occurrence followed within two words by
 *   a flavouring noun is discounted; an animal with only such occurrences is not named at all.
 *   `Homemade Spaghettios` is the case that proves it — `beef broth` AND `chicken bouillon cube`
 *   AND `0.75 lb ground beef`, which without the rule reads as two animals and says nothing.
 * - **Word boundaries.** `ham` inside `hamburger`, `sole` inside `casserole`, `veal` inside
 *   `reveal`. Every pattern is anchored.
 * - **`egg` is excluded**, and this is the exclusion most worth stating rather than hiding: it is
 *   in the enum and it is in most baked goods as a binder, so it would flag every cake as `egg`.
 *   The cost is real — `Easy Fried Rice` is correctly `egg` and this would never find it.
 *
 * Exit codes are this repo's three: 0 nothing flagged, 1 something flagged, 2 could not measure.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("COULD NOT MEASURE: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  console.error("  Nothing was scanned, which is not the same as nothing being wrong.");
  process.exit(2);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

import { animalsNamed } from "../src/animal-words.js";

/*
 * Households come from `recipes`, never from `accounts` or `families`.
 *
 * `check-platform-tables` refused the first version of this file for reading both, and it was
 * right — the backfill beside it carries the argument in full: *"a maintenance script holding the
 * service role is MORE reason to keep it out of platform tables, not less … extracting a platform
 * for app #2 has to be mechanical."* The convenience being bought was telling a real household
 * from a harness one by its owner's email domain, which is exactly the kind of borrowed knowledge
 * that makes a seam advisory.
 *
 * So `--family=<id>` scopes a run, repeatable, and an unscoped run scans everything and says how
 * many households that was. The ids are the caller's to supply, the same way the backfill takes
 * them.
 */
const only = new Set(
  process.argv.filter((a) => a.startsWith("--family=")).map((a) => a.slice("--family=".length)),
);

/** paged, because a PostgREST read caps at 1000 and a silent truncation is a library unscanned */
const page = async <T,>(table: string, select: string): Promise<T[]> => {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const got = await admin.from(table).select(select).is("deleted_at", null).order("id").range(offset, offset + 999);
    if (got.error) { console.error(`COULD NOT MEASURE: ${got.error.message}`); process.exit(2); }
    out.push(...((got.data ?? []) as T[]));
    if ((got.data ?? []).length < 1000) break;
  }
  return out;
};

type Row = { id: string; family_id: string; title: string; principal_protein: string | null; classified_with: string | null };
const all = await page<Row>("recipes", "id, family_id, title, principal_protein, classified_with");
const recipes = only.size > 0 ? all.filter((r) => only.has(r.family_id)) : all;
if (recipes.length === 0) {
  console.error(
    only.size > 0
      ? `COULD NOT MEASURE: no live recipes in ${[...only].join(", ")}. A scan of nothing is not a clean scan.`
      : "COULD NOT MEASURE: no live recipes at all.",
  );
  process.exit(2);
}

// one read for every ingredient rather than one read per recipe: 100 recipes was 100 round trips
const wanted = new Set(recipes.map((r) => r.id));
const ingredients = await page<{ recipe_id: string; item_text: string }>("recipe_ingredients", "id, recipe_id, item_text");
const byRecipe = new Map<string, string[]>();
for (const row of ingredients) {
  if (!wanted.has(row.recipe_id)) continue;
  const list = byRecipe.get(row.recipe_id) ?? [];
  list.push(row.item_text);
  byRecipe.set(row.recipe_id, list);
}

const flagged: string[] = [];
let silent = 0;
for (const recipe of recipes) {
  const named = animalsNamed([recipe.title, ...(byRecipe.get(recipe.id) ?? [])].join("\n"));
  if (named.length !== 1) { silent += 1; continue; }
  const says = named[0]!;
  if (recipe.principal_protein === says) continue;
  flagged.push(
    `  ${recipe.family_id.slice(0, 8)}  ${String(recipe.principal_protein ?? "null").padEnd(11)}` +
      ` but names only ${says.padEnd(9)} [${recipe.classified_with ? "classified" : "NEVER classified"}]  ${recipe.title}`,
  );
}

const households = new Set(recipes.map((r) => r.family_id)).size;
const scanned = recipes.length;
console.log(`scanned ${scanned} recipes across ${households} household(s)${only.size ? ` (scoped to ${only.size})` : ""}`);
console.log(`  ${scanned - silent} named exactly one animal; ${silent} named none or several and were left alone\n`);
if (flagged.length === 0) {
  console.log("TRIPWIRE: nothing flagged.");
  process.exit(0);
}
console.log(`TRIPWIRE: ${flagged.length} recipe(s) name one animal and do not say so`);
for (const line of flagged) console.log(line);
process.exit(1);
