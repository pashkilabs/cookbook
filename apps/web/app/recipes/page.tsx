import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { maybeRow, rows } from "@/lib/rows";
import { platformStore } from "@/lib/platform";
import { keepWholeFamilyLikes, searchRecipes } from "@/lib/recipe-search";
import { startOfWeek, todayIso } from "@/lib/week";
import { ShortlistButton } from "./shortlist-button";
import { Filters, FILTERS, type FilterKey } from "./filters";
import { BrowseTiles } from "./browse/tiles";
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
  searchParams: Promise<{ q?: string; filter?: string; all?: string }>;
}) {
  const { q: rawQuery, filter: rawFilter, all } = await searchParams;
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
  const shortlisted = rows(
    await supabase
    .from("shortlist_entries")
    .select("recipe_id")
    .eq("family_id", family.id)
    .eq("week_start", weekStart)
    .is("deleted_at", null),
    "shortlisted",
  );
  const onThisWeek = new Set((shortlisted ?? []).map((row) => row.recipe_id));

  /*
   * The photographs, so the list is something a person recognises rather than a wall of titles.
   *
   * Two round trips for the whole page, not two per card: one read for the rows, one
   * `createSignedUrls` for all the paths together. The bucket is private, so a URL has to be
   * signed — and it is signed as the person viewing, so the storage policy is what authorises it,
   * the same reasoning as reading the rows.
   */
  const photoFor = new Map<string, string>();
  if (hits.length > 0) {
    const photos = rows(
    await supabase
      .from("photos")
      .select("recipe_id, storage_path")
      .eq("family_id", family.id)
      .in("recipe_id", hits.map(({ recipe }) => recipe.id))
      .is("deleted_at", null),
    "photos",
  );

    const paths = [...new Set((photos ?? []).map((row) => row.storage_path as string))];
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("recipe-photos")
        .createSignedUrls(paths, 600);
      const urlFor = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
      for (const row of photos ?? []) {
        const url = urlFor.get(row.storage_path as string);
        // one photograph per card; a recipe with several is showing whichever came back first
        if (url && !photoFor.has(row.recipe_id as string)) photoFor.set(row.recipe_id as string, url);
      }
    }
  }

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
          <Link className="button quiet" href="/household">
            Household
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

      {/*
        * Browse is the way in, and the flat list is behind it.
        *
        * The complaint was that a flat list is hard to navigate at volume, so adding a second
        * door beside the cluttered thing would not have answered it — the grouping has to be
        * what you land on. Searching or filtering still goes straight to the list, because
        * that is what a person doing either has already told you they want.
        *
        * regression: browse shipped with nothing linking to it and was found only by typing the
        * URL. That is the fourth feature to ship unreachable here — after caption paste, the
        * screenshot upload and the photo control — and each was found by a person going looking
        * rather than by anything automated. A route no navigation reaches is not shipped.
        */}
      <BrowseTiles />

      <Filters q={q} filter={filter} />

      {error && <p className="error">Could not read recipes: {error}</p>}

      {!error && hits.length === 0 && (
        <div className="empty">
          {q || filter ? (
            <>
              <h2>Nothing matches that</h2>
              <p>
                Search looks at titles and ingredients, so “chicken” finds the recipes you can
                cook with what you bought.
              </p>
              <div className="tabs">
                <Link className="button quiet" href="/recipes">
                  Clear search and filters
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2>Your cookbook is empty</h2>
              <p>
                Paste a link from anywhere and it reads the recipe for you — you check it before
                anything is saved. Or type one in from a card or a book.
              </p>
              <div className="tabs">
                <Link className="button" href="/recipes/import">
                  Import from a link
                </Link>
                <Link className="button quiet" href="/recipes/new">
                  Type one in
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      <div className="recipes">
      {hits.map(({ recipe, matchedIngredient }) => (
        <Link className="card" key={recipe.id} href={`/recipes/${recipe.id}`}>
          {photoFor.has(recipe.id) ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; the
            // optimiser would cache a URL that stops working before the cache does
            <img className="card-photo" src={photoFor.get(recipe.id)} alt="" loading="lazy" />
          ) : (
            // holds the grid square so a cookbook part-way through gaining photographs does not
            // look ragged
            <span className="card-photo none" aria-hidden="true">
              {recipe.title.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
          <div className="card-body">
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
          </div>
        </Link>
      ))}
      </div>
    </main>
  );
}
