/**
 * What every chapter page needs, read once.
 *
 * The contents page, a chapter page and a protein page ask the same three questions — who is
 * signed in, which household, and what is in its library — and the third one has to go through
 * `searchRecipes` rather than a fresh query, because that is where the **allergen filter** lives.
 * §6 of the brief: exclusions apply to every chapter with the hidden count stated, and the way
 * this shipped broken once before was a default of "no allergens" at a call site nobody joined up.
 *
 * `family_id` is filtered explicitly and that is not redundant with RLS. Published recipes are
 * world-readable (decisions §17), so RLS legitimately returns other households' public recipes —
 * the first render of the recipe list duly showed a stranger's roast chicken. RLS decides what may
 * leave the database; a screen decides whose kitchen it shows.
 */
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { searchRecipes, type SearchHit } from "@/lib/recipe-search";
import { rows } from "@/lib/rows";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChapterData {
  familyId: string;
  hits: SearchHit[];
  /** how many the allergen filter removed — stated on the page, never a silent absence */
  hiddenByAllergen: number;
  avoidedAllergens: readonly string[];
  error: string | null;
  supabase: SupabaseClient;
}

export async function chapterData(): Promise<ChapterData | null> {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  // a provisioning gap, not an error: the caller renders the same dead-end notice /recipes does
  if (!family) return null;

  const found = await searchRecipes({
    supabase,
    familyId: family.id,
    query: "",
    filter: null,
    avoidedAllergens: family.avoidedAllergens,
  });

  return {
    familyId: family.id,
    hits: found.hits,
    hiddenByAllergen: found.hiddenByAllergen ?? 0,
    avoidedAllergens: family.avoidedAllergens,
    error: found.error,
    supabase: supabase as unknown as SupabaseClient,
  };
}

/**
 * Signed photo URLs for a set of recipes, in one call.
 *
 * Batched the way the recipe list batches them: `createSignedUrls` once for every path, because a
 * call per tile is a round trip per tile. Signed URLs expire, which is why these are `<img src>`
 * and not `next/image` — a cached URL would stop resolving.
 */
export async function photosFor(
  supabase: SupabaseClient,
  familyId: string,
  recipeIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (recipeIds.length === 0) return out;

  /* `rows()` rather than destructuring `data`: a discarded error reads as "this recipe has no
     photograph", which is the silence-reads-as-success shape and indistinguishable from the truth */
  const photos = rows(
    await supabase
      .from("photos")
      .select("recipe_id, storage_path")
      .eq("family_id", familyId)
      .in("recipe_id", [...new Set(recipeIds)])
      .is("deleted_at", null),
    "photos",
  );

  const paths = [...new Set((photos ?? []).map((row) => row.storage_path as string))];
  if (paths.length === 0) return out;

  const { data: signed } = await supabase.storage.from("recipe-photos").createSignedUrls(paths, 600);
  const urlFor = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
  for (const row of photos ?? []) {
    const url = urlFor.get(row.storage_path as string);
    if (url && !out.has(row.recipe_id as string)) out.set(row.recipe_id as string, url);
  }
  return out;
}
