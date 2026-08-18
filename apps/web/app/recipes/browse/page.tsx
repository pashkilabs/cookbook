import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";

/**
 * Browse, the way the sketch draws it: one list mixing courses, dish forms and a meal time.
 *
 * **Three fields behind one picker.** Appetizers, Mains, Desserts and Drinks read `course`; Soup
 * and Salad read `dish_form`; Breakfast/Brunch reads `course` too, because the picker is choosing
 * a *recipe* and `slot` does its job at planning time. The sketch mixes the axes because that is
 * how a person thinks about it, and the fields stay separate because a soup is a main **and** a
 * soup — so a soup that is a main appears under both Soup and Mains. That is correct, not a bug.
 *
 * **Soup and Salad ship; the form chips do not.** `dish_form` scored 13/18 with a systematic
 * reach for "bowl" on anything plated, which is not a filter anyone should trust. But a row a
 * person deliberately taps makes a weaker promise than a chip claiming to filter reliably, and
 * these two rows are what the sketch actually asks for.
 *
 * **Protein ships at 15/18**, corrected on the review screen. It is the axis under Mains and the
 * one the sketch leans on.
 */
const TOP_LEVEL = [
  { key: "starter", label: "Appetizers", field: "course" },
  { key: "soup", label: "Soup", field: "dish_form" },
  { key: "salad", label: "Salad", field: "dish_form" },
  { key: "main", label: "Mains", field: "course" },
  { key: "dessert", label: "Desserts", field: "course" },
  { key: "drink", label: "Drinks", field: "course" },
  { key: "breakfast", label: "Breakfast/Brunch", field: "course" },
  { key: "lunch", label: "Lunch", field: "course" },
] as const;

/** the second level under Mains — three proteins the sketch names, plus a computed one */
const MAIN_FILTERS = [
  { key: "chicken", label: "Chicken" },
  { key: "beef", label: "Beef" },
  { key: "fish", label: "Fish" },
  { key: "kid", label: "Kid-friendly" },
] as const;

/**
 * A tile for a recipe with no photograph.
 *
 * Not a fallback — a design. Most recipes have no picture and the backlog only fills as someone
 * cooks, so a grid that looks broken until then would keep the whole flow from shipping. Serif
 * initials on a warm ground read as a cookbook index rather than as a missing image.
 */
function Placeholder({ title }: { title: string }) {
  const initials = title
    .split(/\s+/)
    .filter((word) => /^[a-z]/i.test(word))
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");

  return (
    <div
      aria-hidden
      style={{
        aspectRatio: "4 / 3",
        display: "grid",
        placeItems: "center",
        background: "var(--tile, #f3ece2)",
        color: "var(--tile-ink, #8a7a66)",
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: "2rem",
        letterSpacing: "0.08em",
        borderRadius: "0.5rem",
      }}
    >
      {initials || "·"}
    </div>
  );
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ in?: string; protein?: string }>;
}) {
  const { in: rawIn, protein: rawProtein } = await searchParams;
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/signin");

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) redirect("/signin");

  const chosen = TOP_LEVEL.find((entry) => entry.key === rawIn) ?? null;

  if (!chosen) {
    return (
      <main className="stack">
        <h1>Browse</h1>
        <div className="tiles">
          {TOP_LEVEL.map((entry) => (
            <Link key={entry.key} className="tile" href={`/recipes/browse?in=${entry.key}`}>
              {entry.label}
            </Link>
          ))}
        </div>
      </main>
    );
  }

  /*
   * Filtered by family_id here, not only by RLS.
   *
   * Published recipes are world-readable by design (§17), so a policy decides what may leave the
   * database and a screen decides whose kitchen it shows. Relying on RLS for presentation put
   * another household's roast chicken in this list once already (CLAUDE.md).
   */
  let query = supabase
    .from("recipes")
    .select("id, title, course, dish_form, principal_protein")
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .eq(chosen.field, chosen.key)
    .order("title");

  const protein = MAIN_FILTERS.find((f) => f.key === rawProtein) ?? null;
  if (protein && protein.key !== "kid") query = query.eq("principal_protein", protein.key);

  const { data: rows } = await query;
  let recipes = rows ?? [];

  /*
   * Kid-friendly is computed, never stored.
   *
   * It is a household's judgement rather than a property of the dish, and `ratings` joined to
   * `family_members.is_child` already holds it — a column would be one household's answer given
   * to every household, and would go stale the moment a child changed their mind.
   *
   * **At least one child rating 4+, and none below.** The stricter reading — every child has
   * rated it — is blank for months, and an empty chip reads as broken rather than as honest.
   */
  if (protein?.key === "kid" && recipes.length > 0) {
    const { data: ratings } = await supabase
      .from("ratings")
      .select("recipe_id, score, family_members!inner(is_child)")
      .eq("family_id", family.id)
      .is("deleted_at", null)
      .in(
        "recipe_id",
        recipes.map((r) => r.id),
      );

    const liked = new Set<string>();
    const disliked = new Set<string>();
    for (const row of ratings ?? []) {
      const member = row.family_members as unknown as { is_child?: boolean } | null;
      if (!member?.is_child) continue;
      if ((row.score as number) >= 4) liked.add(row.recipe_id as string);
      else disliked.add(row.recipe_id as string);
    }
    recipes = recipes.filter((r) => liked.has(r.id) && !disliked.has(r.id));
  }

  const photoFor = new Map<string, string>();
  if (recipes.length > 0) {
    const { data: photos } = await supabase
      .from("photos")
      .select("recipe_id, storage_path")
      .eq("family_id", family.id)
      .is("deleted_at", null)
      .in(
        "recipe_id",
        recipes.map((r) => r.id),
      );
    for (const row of photos ?? []) {
      const signed = await supabase.storage
        .from("recipe-photos")
        .createSignedUrl(row.storage_path as string, 600);
      if (signed.data?.signedUrl) photoFor.set(row.recipe_id as string, signed.data.signedUrl);
    }
  }

  return (
    <main className="stack">
      <p className="meta">
        <Link href="/recipes/browse">← Browse</Link>
      </p>
      <h1>{chosen.label}</h1>

      {chosen.key === "main" && (
        <div className="tabs">
          {MAIN_FILTERS.map((filter) => (
            <Link
              key={filter.key}
              className={`chip${protein?.key === filter.key ? " on" : ""}`}
              href={
                protein?.key === filter.key
                  ? "/recipes/browse?in=main"
                  : `/recipes/browse?in=main&protein=${filter.key}`
              }
            >
              {filter.label}
            </Link>
          ))}
        </div>
      )}

      {recipes.length === 0 ? (
        <p className="meta">
          Nothing here yet. Recipes are sorted as they are imported, and the review screen is where
          a wrong one is put right.
        </p>
      ) : (
        <div className="tiles">
          {recipes.map((recipe) => {
            const photo = photoFor.get(recipe.id);
            return (
              <Link key={recipe.id} className="tile card" href={`/recipes/${recipe.id}`}>
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed URL expires
                  <img src={photo} alt="" style={{ aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "0.5rem" }} />
                ) : (
                  <Placeholder title={recipe.title as string} />
                )}
                <span>{recipe.title}</span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
