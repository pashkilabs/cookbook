import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { Filters, FILTERS, type FilterKey } from "./filters";
import { SignOutButton } from "./sign-out";

/**
 * The household's recipes, with the prototype's three filters.
 *
 * Reads go through the signed-in person's own session so row-level security decides which rows
 * come back. **It still filters by `family_id`, and that is not redundant.** Published recipes
 * are world-readable (decisions §17), so RLS legitimately returns other households' public
 * recipes — the first render of this page duly showed a stranger's roast chicken. Isolation and
 * presentation are different questions.
 *
 * The household id comes from the seam, because `family_members` is a platform table and
 * `check-platform-tables.mjs` fails the build on a direct read.
 */
export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { q: rawQuery, filter: rawFilter } = await searchParams;
  const q = (rawQuery ?? "").trim();
  const filter = FILTERS.some((option) => option.key === rawFilter)
    ? (rawFilter as FilterKey)
    : null;

  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) {
    return (
      <main>
        <div className="bar">
          <div>
            <h1>Recipes</h1>
            <p className="subtitle" style={{ margin: 0 }}>{auth.user.email}</p>
          </div>
          <SignOutButton />
        </div>
        <div className="notice">
          This account has no household yet. Signing out and back in completes provisioning.
        </div>
      </main>
    );
  }

  let query = supabase
    .from("recipes")
    .select("id, title, source_name, servings, time_minutes, times_made, make_again, visibility")
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .eq("status", "active");

  if (q) {
    // titles only. Searching ingredients means a join and a decision about ranking, and
    // neither belongs in the same change as the filters.
    query = query.ilike("title", `%${escapeForLike(q)}%`);
  }
  if (filter === "make-again") query = query.eq("make_again", true);
  if (filter === "untried") query = query.eq("times_made", 0);

  const { data: found, error } = await query.order("created_at", { ascending: false });
  let recipes = found ?? [];

  if (filter === "family-likes" && recipes.length > 0) {
    // Computed here rather than in the query. "Everybody who rated gave 4 or 5" is a condition
    // over a *group* of rows, and expressing it through PostgREST means a view or an RPC — both
    // of which are schema changes, and this filter is not worth one yet. A household's ratings
    // are a small set, so one extra read decides it.
    const { data: ratings } = await supabase
      .from("ratings")
      .select("recipe_id, score")
      .eq("family_id", family.id)
      .in("recipe_id", recipes.map((recipe) => recipe.id))
      .is("deleted_at", null);

    const byRecipe = new Map<string, number[]>();
    for (const rating of ratings ?? []) {
      const scores = byRecipe.get(rating.recipe_id) ?? [];
      scores.push(rating.score);
      byRecipe.set(rating.recipe_id, scores);
    }
    // an unrated recipe is not "liked by the whole family" — it is unknown, which is what
    // "Untried" is for
    recipes = recipes.filter((recipe) => {
      const scores = byRecipe.get(recipe.id);
      return !!scores && scores.length > 0 && scores.every((score) => score >= 4);
    });
  }

  return (
    <main>
      <div className="bar">
        <div>
          <h1>{family.name}</h1>
          <p className="subtitle" style={{ margin: 0 }}>{auth.user.email}</p>
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          <Link className="button" href="/recipes/new">
            Add a recipe
          </Link>
          <SignOutButton />
        </div>
      </div>

      <Filters q={q} filter={filter} />

      {error && <p className="error">Could not read recipes: {error.message}</p>}

      {!error && recipes.length === 0 && (
        <div className="empty">
          {q || filter ? (
            <>
              <p style={{ marginTop: 0 }}>Nothing matches that.</p>
              <p style={{ marginBottom: 0 }}>
                <Link href="/recipes">Clear the search and filters</Link>
              </p>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>No recipes yet.</p>
              <p style={{ marginBottom: 0 }}>
                <Link href="/recipes/new">Type one in</Link> — importing has no screen yet.
              </p>
            </>
          )}
        </div>
      )}

      {recipes.map((recipe) => (
        <Link className="card" key={recipe.id} href={`/recipes/${recipe.id}`}>
          <h2>{recipe.title}</h2>
          <p className="meta" style={{ margin: 0 }}>
            {[
              recipe.source_name,
              recipe.servings ? `serves ${recipe.servings}` : null,
              recipe.time_minutes ? `${recipe.time_minutes} min` : null,
              recipe.times_made ? `made ${recipe.times_made}×` : "untried",
              recipe.make_again === true ? "make again" : null,
              recipe.visibility === "public" ? "published" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </Link>
      ))}
    </main>
  );
}

/**
 * `%` and `_` are wildcards in `LIKE`, so a search for "50%" would otherwise match everything
 * containing "50". Backslash-escaped, which is what Postgres expects by default.
 */
function escapeForLike(input: string): string {
  return input.replace(/[\\%_]/g, (character) => `\\${character}`);
}
