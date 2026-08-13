import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { keepWholeFamilyLikes, searchRecipes } from "@/lib/recipe-search";
import { startOfWeek, todayIso } from "@/lib/week";
import { ShortlistButton } from "./shortlist-button";
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

  const found = await searchRecipes({ supabase, familyId: family.id, query: q, filter });
  const hits =
    filter === "family-likes"
      ? await keepWholeFamilyLikes(supabase, family.id, found.hits)
      : found.hits;
  const error = found.error;

  // which of these are already wanted this week, so the button starts in the right state
  const weekStart = startOfWeek(todayIso());
  const { data: shortlisted } = await supabase
    .from("shortlist_entries")
    .select("recipe_id")
    .eq("family_id", family.id)
    .eq("week_start", weekStart)
    .is("deleted_at", null);
  const onThisWeek = new Set((shortlisted ?? []).map((row) => row.recipe_id));

  return (
    <main>
      <div className="bar">
        <div>
          <h1>{family.name}</h1>
          <p className="subtitle" style={{ margin: 0 }}>{auth.user.email}</p>
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          <Link className="button" href="/planner">
            Planner
          </Link>
          <Link className="button" href="/recipes/import">
            Import
          </Link>
          <Link className="button" href="/recipes/new">
            Add a recipe
          </Link>
          <SignOutButton />
        </div>
      </div>

      <Filters q={q} filter={filter} />

      {error && <p className="error">Could not read recipes: {error}</p>}

      {!error && hits.length === 0 && (
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
                <Link href="/recipes/import">Import one from a link</Link> or <Link href="/recipes/new">type one in</Link>.
              </p>
            </>
          )}
        </div>
      )}

      {hits.map(({ recipe, matchedIngredient }) => (
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
          {/* why this one is here, when the title says nothing about the search */}
          {matchedIngredient && (
            <p className="matched">contains {matchedIngredient}</p>
          )}
          <div className="card-actions">
            <ShortlistButton
              recipeId={recipe.id}
              weekStart={weekStart}
              shortlisted={onThisWeek.has(recipe.id)}
            />
          </div>
        </Link>
      ))}
    </main>
  );
}
