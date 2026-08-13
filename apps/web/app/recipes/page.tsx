import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { SignOutButton } from "./sign-out";

/**
 * The recipe list, read as the signed-in person so row-level security decides what comes
 * back.
 *
 * **It still filters by `family_id`, and that is not a redundant belt.** RLS decides what
 * this person is *allowed* to see, and since decisions §17 made published recipes
 * world-readable, that legitimately includes every public recipe on the platform. Isolation
 * and presentation are different questions: without the filter, "Recipes" showed a stranger's
 * published roast chicken, which the first render of this page duly did. The filter is about
 * whose kitchen this is; the policy is about whose data may leave the database.
 *
 * The household id comes from the seam, not from a query against `family_members` — that is
 * a platform table and `check-platform-tables.mjs` fails the build on a direct read. Server
 * component, so the seam's service role never approaches the browser.
 *
 * Tombstones are excluded here rather than by policy, because a deleted row stays readable
 * on purpose: a device reconciling has to be able to see that it went (architecture §5).
 */
export default async function RecipesPage() {
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
          This account has no household yet. Signing up creates one; if you are seeing this,
          provisioning was interrupted — signing out and back in completes it.
        </div>
      </main>
    );
  }

  const { data: recipes, error } = await supabase
    .from("recipes")
    .select("id, title, source_name, servings, time_minutes, times_made, visibility")
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  return (
    <main>
      <div className="bar">
        <div>
          <h1>{family.name}</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            {auth.user.email}
          </p>
        </div>
        <SignOutButton />
      </div>

      {error && (
        <p className="error">
          Could not read recipes: {error.message}
        </p>
      )}

      {!error && recipes && recipes.length === 0 && (
        <div className="empty">
          <p style={{ marginTop: 0 }}>No recipes yet.</p>
          <p style={{ marginBottom: 0 }}>
            Importing is built but has no screen — that arrives with the review flow. A new
            household also has no entitlement, so it can read and not write until
            subscription issuance exists.
          </p>
        </div>
      )}

      {recipes?.map((recipe) => (
        <article className="card" key={recipe.id}>
          <h2>{recipe.title}</h2>
          <p className="meta" style={{ margin: 0 }}>
            {[
              recipe.source_name,
              recipe.servings ? `serves ${recipe.servings}` : null,
              recipe.time_minutes ? `${recipe.time_minutes} min` : null,
              recipe.times_made ? `made ${recipe.times_made}×` : null,
              recipe.visibility === "public" ? "published" : null,
            ]
              .filter(Boolean)
              .join(" · ") || "no details yet"}
          </p>
        </article>
      ))}
    </main>
  );
}
