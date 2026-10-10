/**
 * What else is worth cooking this week, and *why* — three answers, never one score.
 *
 * ---------------------------------------------------------------------------
 * Three separate lines, each with its reason
 * ---------------------------------------------------------------------------
 *
 * Stephen named three signals: shares a base, uses up leftovers, rated well. They pull apart —
 * the best-rated recipe may share nothing, the one that finishes the cream may be untried — and
 * they are not equally reliable:
 *
 *   uses up leftovers   exact arithmetic over base units. True or false.
 *   shares a base       one in five at the shipped threshold. A guess with a number behind it.
 *   rated well          needs six ratings on a dimension before it says anything, and this
 *                       household has 26 across 7 recipes. Mostly silent.
 *
 * A single ranked list mixing a certainty, a guess and a thin statistic produces a number whose
 * confidence cannot be read — **§61's shape exactly**: bounded, moving, looks like a confidence,
 * and nothing can check it. That failure has already been measured here once.
 *
 * So each line states what it rests on, and each may be empty. "Shares the hibachi vegetables"
 * and "uses the cream you will have spare" are different sentences, and a cook can judge which
 * matters tonight. The taste readings settled the principle: *an observation a person can weigh
 * beats a verdict they can only accept or ignore.*
 *
 * ---------------------------------------------------------------------------
 * After placing, not while choosing
 * ---------------------------------------------------------------------------
 *
 * A footnote on the week rather than an interruption at the moment of choosing. Two reasons: a
 * warning is more forceful than a display and this is a display, and **the cook has already
 * committed** — so it reads as "and while you're at it" rather than "are you sure".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  asIngredients,
  createCatalog,
  parseIngredientList,
  recipesSharingBase,
  type SharedBase,
} from "@pashki/core";
import { catalogItemsFromRows, INGREDIENT_COLUMNS, GROCERY_PACKAGE_COLUMNS } from "@pashki/db/catalog";
import { rows } from "./rows";
import { readAvoidedAllergens } from "./allergen-filter";

export interface Alongside {
  /** recipes sharing enough with something already planned that one batch might do for both */
  sharesABase: Array<{ id: string; title: string; with: string; shared: string[] }>;
  /** nothing computed here — the shopping list owns leftovers, and this links to it */
  leftoversLiveOnTheList: boolean;
}

/**
 * Recipes sharing a base with anything planned this week.
 *
 * Reads the household's own library, scoped by `family_id` rather than left to RLS: a policy
 * decides what may leave the database and a screen decides whose kitchen it shows.
 */
export async function alongsideThisWeek(
  supabase: SupabaseClient,
  familyId: string,
  plannedRecipeIds: readonly string[],
  system: "us" | "metric",
  /*
   * What the household avoids (§71). This screen **offers** recipes, so it filters — "a recipe
   * hidden in one place and offered in another is worse than consistent silence", and a
   * suggestion is the strongest form of offering there is.
   */
  avoidedAllergens: readonly string[] = [],
): Promise<Alongside> {
  if (plannedRecipeIds.length === 0) {
    return { sharesABase: [], leftoversLiveOnTheList: false };
  }

  const [ingredientRows, packageRows] = await Promise.all([
    supabase.from("ingredients").select(INGREDIENT_COLUMNS),
    supabase.from("grocery_packages").select(GROCERY_PACKAGE_COLUMNS),
  ]);
  const catalog = createCatalog(
    catalogItemsFromRows(
      rows(ingredientRows, "catalog ingredients") as never,
      rows(packageRows, "catalog packages") as never,
      system,
    ),
  );

  /*
   * One query for every recipe's lines rather than one per recipe — the same shape the shopping
   * list uses, and the reason this is affordable as a footnote.
   */
  const recipeRows = rows(
    await supabase
      .from("recipes")
      .select("id, title, recipe_ingredients(item_text, deleted_at)")
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .eq("status", "active")
      // a blend is assembled from recipes already here; suggesting one as a "shared base" would
      // be suggesting a thing made of the thing it shares with
      .is("derived_at", null),
    "library for alongside",
  );

  const library = recipeRows.map((row) => {
    const lines = ((row.recipe_ingredients ?? []) as Array<{ item_text: string | null; deleted_at: string | null }>)
      .filter((line) => line.deleted_at === null)
      .map((line) => line.item_text ?? "");
    return {
      id: row.id as string,
      title: row.title as string,
      ingredients: asIngredients(parseIngredientList(lines)),
    };
  });

  const avoided = await readAvoidedAllergens(supabase, familyId, avoidedAllergens);
  const byId = new Map(library.map((recipe) => [recipe.id, recipe]));
  const planned = new Set(plannedRecipeIds);

  /*
   * Keyed by the suggestion, so a recipe sharing a base with two planned meals is offered once
   * — with whichever overlap is longest, since the longer one is the likelier to be a base.
   */
  const best = new Map<string, { entry: SharedBase<(typeof library)[number]>; with: string }>();
  for (const id of planned) {
    const source = byId.get(id);
    if (!source) continue;
      // removed, not demoted: an allergy is an exclusion and a suggestion list is an offer
      const candidates = library.filter(
        (recipe) => !planned.has(recipe.id) && !avoided.excluded.has(recipe.id),
      );
    for (const found of recipesSharingBase(source, candidates, catalog)) {
      const existing = best.get(found.recipe.id);
      if (!existing || found.shared.length > existing.entry.shared.length) {
        best.set(found.recipe.id, { entry: found, with: source.title });
      }
    }
  }

  return {
    sharesABase: [...best.values()]
      .sort((a, b) => b.entry.shared.length - a.entry.shared.length)
      .slice(0, 4)
      .map(({ entry, with: withTitle }) => ({
        id: entry.recipe.id,
        title: entry.recipe.title,
        with: withTitle,
        shared: entry.labels,
      })),
    leftoversLiveOnTheList: true,
  };
}
