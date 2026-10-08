/**
 * Two numbers that grow on their own, and the thresholds at which they are worth acting on.
 *
 * ---------------------------------------------------------------------------
 * Why a script and not a note
 * ---------------------------------------------------------------------------
 *
 * Both of these improve passively — section coverage with every import that has headings,
 * hand-labelled boundaries with every blend somebody corrects — and neither has anything to do
 * until it has accumulated. The obvious plan is "remember to re-measure", and this project has
 * watched that shape fail enough times to have written it down: *a version stamp only works if
 * somebody turns it.* A number nobody is asked for is a number nobody looks at.
 *
 * So the trigger is a command. `pnpm --filter @pashki/import ripeness` answers "is there enough
 * yet" in one line each, with the threshold beside the count so the answer is checkable rather
 * than asserted.
 *
 * ---------------------------------------------------------------------------
 * What each one unlocks
 * ---------------------------------------------------------------------------
 *
 * **Sections.** Supplying true section headings took component detection from `right` 14 to 25
 * of thirty (§60). The measured corpus had *zero* of them, which is why §60 records today's
 * score as a floor rather than a verdict. Every import carrying headings raises it with no code
 * change — and a stored partition can be recomputed when it does.
 *
 * **Adjusted boundaries.** §61 leaves no confidence signal, so a person correcting a proposed
 * split is the only evaluator. Every correction is a hand label produced as a side effect of
 * somebody cooking — and unlike the thirty I labelled by hand, these are *the household's own
 * recipes* rather than ones I chose, which makes them better evidence than the eval has ever
 * had.
 *
 * Neither threshold is precise and neither pretends to be. Thirty is what the existing labelled
 * set holds, so it is the number at which a comparison is like-for-like.
 *
 * ---------------------------------------------------------------------------
 * And the third: repeat cooks, which is §64's reversal condition
 * ---------------------------------------------------------------------------
 *
 * Bases — cook a component once, freeze it, finish it several ways — were rejected on
 * measurement (§64): a base substitutes for ingredients *plus a stretch of method*, and an
 * ingredient list cannot express the second, so no matcher reading ingredient lines can find a
 * finish. A perfect matcher buys three matches.
 *
 * What the measurement pointed at instead is that a finish is **the same recipe again, minus a
 * part already made** — which needs one column on `plan_entries`, not a new object. That only
 * pays off once recipes are actually cooked more than once and split into parts, and both were
 * zero when it was proposed. So the condition is reported here rather than remembered: a
 * number nobody is asked for is a number nobody looks at.
 */
import { readFileSync } from "node:fs";
import { createCatalog, normaliseName, parseIngredientList, isStaple } from "../../core/src/index.js";
import { catalogItemsFromRows, INGREDIENT_COLUMNS, GROCERY_PACKAGE_COLUMNS } from "../../db/src/catalog.js";

for (const line of readFileSync(new URL("../../../apps/web/.env.local", import.meta.url), "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !line.startsWith("#")) process.env[line.slice(0, at).trim()] ??= line.slice(at + 1).trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  // could-not-measure is a third outcome and must not read like a zero
  console.error("COULD NOT MEASURE: no Supabase credentials in apps/web/.env.local");
  process.exit(3);
}

/** rows, with the error surfaced rather than an empty array standing in for a failure */
async function rows(path: string): Promise<unknown[]> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key!, authorization: `Bearer ${key!}` },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return (await response.json()) as unknown[];
}

/** counts through PostgREST's exact count, so nothing is paged or estimated */
async function count(path: string): Promise<number> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key!,
      authorization: `Bearer ${key!}`,
      prefer: "count=exact",
      range: "0-0",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const range = response.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  if (!Number.isFinite(total)) throw new Error(`no count in content-range: "${range}"`);
  return total;
}

const SECTIONS_WANTED = 30;
const ADJUSTMENTS_WANTED = 30;
/*
 * Six rather than thirty, and lower on purpose. This is not a corpus to measure against — it
 * is evidence that a household repeats meals at all, which is the only question §64 left open.
 * Half a dozen recipes cooked twice is enough to tell.
 */
const REPEATS_WANTED = 6;
/*
 * One week is enough, because the question is whether the moment ever arrives.
 *
 * §66 measured which recipes share a base: 8 candidate sets over 11 of 79 recipes, six of them
 * real — a Greek salad finished three ways, two marinades, a hibachi vegetable base. The useful
 * moment is not on a recipe, it is in the planner: *"Tuesday and Thursday share the huli-huli
 * marinade, make it once"*, which turns overlap into a saved job.
 *
 * With 11 recipes in any group, that moment fires roughly never today, and a screen that is
 * correct and silent is the shape this project keeps shipping. So the number is reported and the
 * screen is not built. One week with a sharing pair is the signal: it means the household's own
 * planning has produced the case, rather than the corpus merely containing it.
 */
const SHARING_WEEKS_WANTED = 1;
/*
 * Six, and the first run of this line is why.
 *
 * §66 catalogued candidates at five shared items, where 6 of 8 are real. A TRIGGER cannot live
 * with 2 in 8: set to five it reported READY on `avocado, cilantro, cumin, garlic powder, lime`
 * — two recipes that share a garnish, not a base — and a trigger that fires on noise is one
 * that gets ignored, which is the failure this project keeps naming.
 *
 * At six, all five remaining candidates are real. It loses the one group of three, which matters
 * for *cataloguing* bases and not for the question here: has the household's own planning put
 * two meals sharing a base in the same week? Precision is what makes that answer worth reading.
 */
const SHARED_ITEMS = 6;
/*
 * Component names that are not bare role words — §68's cheaper reversal condition.
 *
 * **Recipes with two or more parts**, which is the population question three attempts converged
 * on. Counted free from the partitions already stored, so it accumulates with no model calls.
 *
 * This counted *names that are not a role word* until the naming prompt was fixed, and then it
 * became meaningless: with the prompt asking for a name, `loaded potato soup` is not a role word
 * and is also not a base — a one-pan dinner named once is the correct answer, and it passed.
 * Measured on ten recipes, naming went from 8 of 9 role-named to 0 of 10 while the population
 * stayed at 2 of 10. Two different questions, and the easy one had been standing in for the
 * hard one.
 */
const BASE_NAMES_WANTED = 6;

try {
  const recipes = await count("recipes?select=id&deleted_at=is.null");
  /*
   * Blends are excluded, and leaving them in was wrong in the direction that flatters.
   *
   * `composeBlend` writes each part's name into `section`, so every blend counts as a recipe
   * "carrying a declared section" — but that is structure this app generated, not a heading a
   * recipe declared, and it tells us nothing about whether imports are getting better. The
   * first run of this script reported four sectioned recipes when four blends existed and the
   * real answer was zero.
   */
  const query =
    "recipe_ingredients?select=recipe_id,recipes!inner(derived_at)" +
    "&section=not.is.null&deleted_at=is.null&recipes.derived_at=is.null";
  const sectionRows = (await (
    await fetch(`${url}/rest/v1/${query}`, {
      headers: { apikey: key!, authorization: `Bearer ${key!}` },
    })
  ).json()) as Array<{ recipe_id: string }>;
  const sectioned = sectionRows.length;
  // distinct recipes: one recipe contributes many rows
  const withSections = new Set(sectionRows.map((row) => row.recipe_id)).size;

  const blends = await count("recipes?select=id&derived_at=not.is.null&deleted_at=is.null");

  /*
   * A bare role word is not a base name. Read from stored partitions, excluding blends —
   * `composeBlend` writes a part's name into `section` and its own lineage, which is structure
   * this app generated rather than a model naming a part of a recipe.
   */
  const partitioned = (await rows(
    "recipes?select=id,components&components=not.is.null&derived_at=is.null&deleted_at=is.null",
  )) as Array<{ components: unknown }>;
  let componentNames = 0;
  let baseNames = 0;
  for (const row of partitioned) {
    if (!Array.isArray(row.components)) continue;
    componentNames += 1;
    // two or more parts: one component is the whole dish, correctly, and is not a base
    if (row.components.length > 1) baseNames += 1;
  }
  const repeated = await count("recipes?select=id&times_made=gt.1&deleted_at=is.null");
  const cooked = await count("recipes?select=id&times_made=gt.0&deleted_at=is.null");
  // a part marked done needs a part to mark: components and repeats both have to be non-zero
  const splitRows = (await (
    await fetch(`${url}/rest/v1/recipes?select=id,components&components=not.is.null&derived_at=is.null&deleted_at=is.null`, {
      headers: { apikey: key!, authorization: `Bearer ${key!}` },
    })
  ).json()) as Array<{ components: unknown }>;
  const split = splitRows.filter((r) => Array.isArray(r.components) && r.components.length > 1).length;
  const adjusted = await count(
    "recipe_derivations?select=id&adjusted=is.true&deleted_at=is.null",
  );

  /*
   * Grouped by shared ITEMSET over catalog keys, never by transitive closure. A-B at four and
   * B-C at four with A-C at zero is a path through a similarity graph, not a shared base — the
   * wrong version produced a group of six with nothing in common across all of it (§66).
   */
  const ingredientRows = await rows(`ingredients?select=${INGREDIENT_COLUMNS}`);
  const packageRows = await rows(`grocery_packages?select=${GROCERY_PACKAGE_COLUMNS}`);
  const catalog = createCatalog(
    catalogItemsFromRows(ingredientRows as never, packageRows as never),
  );

  const CARB = /\b(pasta|spaghetti|noodle|rice|bread|roll|tortilla|bun|potato|flour|couscous|quinoa|orzo|macaroni|lasagn)/i;
  const PROTEIN = /\b(chicken|beef|pork|lamb|turkey|bacon|sausage|mince|brisket|steak|shrimp|prawn|salmon|cod|tilapia|fish|tofu|egg)/i;
  const AROMATIC = new Set(["onion", "garlic", "shallot", "ginger", "spring onion", "scallion"]);

  const lineRows = (await rows(
    "recipe_ingredients?select=recipe_id,item_text&deleted_at=is.null",
  )) as Array<{ recipe_id: string; item_text: string | null }>;
  const linesByRecipe = new Map<string, string[]>();
  for (const row of lineRows) {
    linesByRecipe.set(row.recipe_id, [...(linesByRecipe.get(row.recipe_id) ?? []), row.item_text ?? ""]);
  }
  const baseKeys = (recipeId: string): Set<string> => {
    const out = new Set<string>();
    for (const parsed of parseIngredientList(linesByRecipe.get(recipeId) ?? [])) {
      const text = parsed.item;
      if (!text || isStaple(text)) continue;
      const item = catalog.find(text);
      const key = item ? item.key : normaliseName(text);
      // the thing a base is finished WITH is excluded by definition, and so is noise
      if (!key || item?.aisle === "Meat & Seafood" || PROTEIN.test(key) || CARB.test(key) || AROMATIC.has(key)) continue;
      out.add(key);
    }
    return out;
  };

  const planned = (await rows(
    "plan_entries?select=recipe_id,meal_plan_id&deleted_at=is.null",
  )) as Array<{ recipe_id: string; meal_plan_id: string }>;
  const byWeek = new Map<string, Set<string>>();
  for (const entry of planned) {
    byWeek.set(entry.meal_plan_id, new Set([...(byWeek.get(entry.meal_plan_id) ?? []), entry.recipe_id]));
  }
  let sharingWeeks = 0;
  let bestPair = "";
  for (const [, ids] of byWeek) {
    const list = [...ids];
    let found = false;
    for (let i = 0; i < list.length && !found; i += 1)
      for (let j = i + 1; j < list.length && !found; j += 1) {
        const a = baseKeys(list[i]!), b = baseKeys(list[j]!);
        const shared = [...a].filter((k) => b.has(k));
        if (shared.length >= SHARED_ITEMS) {
          found = true;
          if (!bestPair) bestPair = shared.slice(0, 5).join(", ");
        }
      }
    if (found) sharingWeeks += 1;
  }

  const verdict = (have: number, want: number) =>
    have >= want ? `READY — re-measure` : `${want - have} more`;

  console.log(`\n${recipes} recipes, ${blends} of them blends\n`);
  console.log(
    `  imported recipes with their own headings${String(withSections).padStart(4)} / ${SECTIONS_WANTED}   ${verdict(withSections, SECTIONS_WANTED)}`,
  );
  console.log(`     (${sectioned} ingredient rows across them)`);
  console.log(
    `  blend parts a person re-drew          ${String(adjusted).padStart(4)} / ${ADJUSTMENTS_WANTED}   ${verdict(adjusted, ADJUSTMENTS_WANTED)}`,
  );
  console.log(
    `  recipes cooked more than once         ${String(repeated).padStart(4)} / ${REPEATS_WANTED}   ${verdict(repeated, REPEATS_WANTED)}`,
  );
  console.log(`     (${cooked} cooked at least once, ${split} split into two or more parts)`);
  console.log(
    `  weeks where two planned meals share a base  ${String(sharingWeeks).padStart(2)} / ${SHARING_WEEKS_WANTED}   ${verdict(sharingWeeks, SHARING_WEEKS_WANTED)}`,
  );
  console.log(
    `     (${byWeek.size} weeks planned, ${SHARED_ITEMS}+ shared non-protein, non-carb, non-staple items${bestPair ? `; e.g. ${bestPair}` : ""})`,
  );
  console.log(
    `  recipes split into two or more parts ${String(baseNames).padStart(4)} / ${BASE_NAMES_WANTED}   ${verdict(baseNames, BASE_NAMES_WANTED)}`,
  );
  console.log(`     (of ${componentNames} recipes with a stored partition)`);
  console.log(`
  §68's cheaper reversal condition, and the one a fourth attempt at bases should check FIRST.
  The single real split in this library names its parts "protein" and "carbohydrate", while every
  discussion of the feature argued from "the huli-huli marinade" — an example nobody had checked.
  The naming blocker is closed: the prompt never asked for a name and the schema's example was
  "the sauce", so the field echoed the category back. Measured on ten recipes, naming went from
  8 of 9 role-named to 0 of 10, and the hard case — a poke bowl — went from
  "sauce / protein / carbohydrate / vegetable" to "spicy mayo / marinated chicken / jasmine rice
  / poke bowl toppings", against a hand label of "spicy mayo / glazed chicken / rice / bowl
  toppings".

  The POPULATION did not move: 2 of 10 recipes have two or more parts, against 3 of 9 before. So
  §68 stands — most recipes here are complete dishes, and the prompt could not change that.
  Fixing the naming raised what the app can *identify*, not what exists.
`);
  console.log(`
  §66 found six real shared bases across 11 of 79 recipes — a Greek salad finished three ways,
  two marinades, a hibachi vegetable base. The moment worth a screen is in the PLANNER: "Tuesday
  and Thursday share the huli-huli marinade, make it once", which turns overlap into a saved job.
  With 11 recipes in any group it fires about never, and a screen that is correct and silent is
  the shape this project keeps shipping. One sharing week means the household's own planning has
  produced the case rather than the corpus merely containing it.

  It can say "make the marinade once". It must never say "skip to step 7" — overlap says what is
  shared, never where in the method it is made (§64, from the other side).
`);
  console.log(`
  Repeat cooks are §64's reversal condition. Bases were rejected because a base substitutes
  for ingredients PLUS a stretch of method and an ingredient list cannot express the second —
  so no matcher finds a finish, and a perfect one buys three matches. What does work is "the
  same recipe again, minus a part you already made", and that needs recipes actually cooked
  twice and split into parts. At ${REPEATS_WANTED} repeats with some splits, it is one column
  on plan_entries rather than a new object.
`);
  console.log(`
  Sections raise component detection with no code change — §60 records today's score as a
  floor because the measured corpus had none. At ${SECTIONS_WANTED}, re-run the components eval
  against recipes that have them and see where the floor actually is.

  Adjusted parts are hand labels made by somebody cooking, on their own recipes rather than
  ones I chose. At ${ADJUSTMENTS_WANTED} they are a held-out set the eval has never had, and the
  question they answer is the one §61 left open: where does detection actually go wrong?
`);
} catch (thrown) {
  console.error(`COULD NOT MEASURE: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  process.exit(3);
}
