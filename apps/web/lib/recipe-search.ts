import { maybeRow, rows } from "./rows";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Search a household's recipes by title *and* by ingredient.
 *
 * "What can I make with the chicken I bought" is the query that gets used, and the answer is in
 * `recipe_ingredients.item_text` — which the first version of this ignored.
 *
 * **Two queries and a merge, not one.** PostgREST can filter on an embedded resource, but that
 * makes it an inner join: recipes with no ingredients disappear, and "title matches OR an
 * ingredient matches" is not expressible as a single filter. The alternative is a view or an
 * RPC with a `tsvector` — which is the right answer at a scale a household does not have. Two
 * indexed `ilike` scans over one family's rows is cheap, and it keeps ranking here where the
 * reason for it is visible.
 *
 * **Titles rank first.** Somebody searching "chicken" who has a recipe called Chicken Pie means
 * that recipe; the ones that merely contain chicken come after. Within each group, newest first.
 */
export interface RecipeRow {
  id: string;
  title: string;
  source_name: string | null;
  servings: number | null;
  time_minutes: number | null;
  times_made: number;
  make_again: boolean | null;
  visibility: string;
}

export interface SearchHit {
  recipe: RecipeRow;
  /** the ingredient line that matched, when the title did not */
  matchedIngredient: string | null;
}

const COLUMNS =
  // one literal, not a concatenation: PostgREST infers the row type from the string and a `+`
  // collapses it to GenericStringError[]. The classification columns are here because the list
  // drills down by course, dish form and protein now that browse is gone.
  "id, title, source_name, servings, time_minutes, times_made, make_again, visibility, course, dish_form, principal_protein";

export interface SearchOptions {
  supabase: SupabaseClient;
  familyId: string;
  /** already trimmed; empty means "no search, just the filters" */
  query: string;
  filter: "make-again" | "untried" | "family-likes" | "kid-friendly" | null;
}

export async function searchRecipes(options: SearchOptions): Promise<{
  hits: SearchHit[];
  error: string | null;
}> {
  const { supabase, familyId, query, filter } = options;

  const base = () => {
    let builder = supabase
      .from("recipes")
      .select(COLUMNS)
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .eq("status", "active");
    if (filter === "make-again") builder = builder.eq("make_again", true);
    if (filter === "untried") builder = builder.eq("times_made", 0);
    return builder;
  };

  if (!query) {
    const { data, error } = await base().order("created_at", { ascending: false });
    if (error) return { hits: [], error: error.message };
    return { hits: withFamilyLikes(data ?? [], new Map()), error: null };
  }

  const pattern = `%${escapeForLike(query)}%`;

  const byTitle = await base().ilike("title", pattern).order("created_at", { ascending: false });
  if (byTitle.error) return { hits: [], error: byTitle.error.message };

  // Scoped by family_id as well as by the join, because RLS would return another household's
  // ingredient rows for a published recipe and this is a search of *our* kitchen.
  const byIngredient = await supabase
    .from("recipe_ingredients")
    .select("recipe_id, item_text")
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .ilike("item_text", pattern);
  if (byIngredient.error) return { hits: [], error: byIngredient.error.message };

  const titleIds = new Set((byTitle.data ?? []).map((recipe) => recipe.id));
  const matchedIngredients = new Map<string, string>();
  for (const line of byIngredient.data ?? []) {
    // the first match is enough to explain why the recipe is in the list
    if (!titleIds.has(line.recipe_id) && !matchedIngredients.has(line.recipe_id)) {
      matchedIngredients.set(line.recipe_id, line.item_text);
    }
  }

  let ingredientOnly: RecipeRow[] = [];
  if (matchedIngredients.size > 0) {
    // the same filters apply, so a recipe found by its ingredients still has to be untried or
    // marked make-again when that is what was asked for
    const { data, error } = await base()
      .in("id", [...matchedIngredients.keys()])
      .order("created_at", { ascending: false });
    if (error) return { hits: [], error: error.message };
    ingredientOnly = data ?? [];
  }

  return {
    hits: withFamilyLikes([...(byTitle.data ?? []), ...ingredientOnly], matchedIngredients),
    error: null,
  };
}

function withFamilyLikes(
  recipes: RecipeRow[],
  matchedIngredients: Map<string, string>,
): SearchHit[] {
  return recipes.map((recipe) => ({
    recipe,
    matchedIngredient: matchedIngredients.get(recipe.id) ?? null,
  }));
}

/**
 * Keep only recipes every rater scored 4 or 5.
 *
 * Separate from the query on purpose: it is a condition over a *group* of rows, and expressing
 * it through PostgREST needs a view or an RPC. An unrated recipe is not liked by the whole
 * family — it is unknown, which is what the untried filter is for.
 */
export async function keepWholeFamilyLikes(
  supabase: SupabaseClient,
  familyId: string,
  hits: SearchHit[],
): Promise<SearchHit[]> {
  if (hits.length === 0) return hits;

  const data = rows(
    await supabase
    .from("ratings")
    .select("recipe_id, score")
    .eq("family_id", familyId)
    .in("recipe_id", hits.map((hit) => hit.recipe.id))
    .is("deleted_at", null),
    "data",
  );

  const scores = new Map<string, number[]>();
  for (const rating of data ?? []) {
    const existing = scores.get(rating.recipe_id) ?? [];
    existing.push(rating.score);
    scores.set(rating.recipe_id, existing);
  }

  return hits.filter((hit) => {
    const given = scores.get(hit.recipe.id);
    return !!given && given.length > 0 && given.every((score) => score >= 4);
  });
}

/**
 * `%` and `_` are wildcards in `LIKE`, so a search for "50%" would otherwise match everything
 * containing "50". Backslash-escaped, which is what Postgres expects by default.
 */
export function escapeForLike(input: string): string {
  return input.replace(/[\\%_]/g, (character) => `\\${character}`);
}
