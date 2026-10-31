import type { SupabaseClient } from "@supabase/supabase-js";
import type { LibraryShape } from "./recipe-layout";

/**
 * How big this household's library is, and how much of it a fridge layout could sort.
 *
 * Three counts rather than a page of rows: the only consumer is a sentence on `/household`, and
 * fetching 80 recipes to length-check them would make a settings screen pay for a paragraph.
 *
 * `family_id` is spelled on every one of them. RLS would scope these reads anyway, and that is
 * exactly the reasoning that put another household's roast chicken on the recipe list: a policy
 * decides what may *leave* the database, and published recipes are world-readable by design, so a
 * household-scoped count has to say whose household it is counting.
 *
 * `deleted_at is null` for the same reason the screens use it — a tombstoned recipe is gone as far
 * as anybody reading this number is concerned, and the earlier hard-coded figure was computed
 * "under every way of counting (live, including deleted, every household)", which is three
 * different numbers presented as one.
 */
export async function readLibraryShape(
  supabase: SupabaseClient,
  familyId: string,
): Promise<LibraryShape> {
  const base = () =>
    supabase
      .from("recipes")
      .select("id", { count: "exact", head: true })
      .eq("family_id", familyId)
      .is("deleted_at", null);

  const [total, mains, named] = await Promise.all([
    base(),
    base().eq("course", "main"),
    base().eq("course", "main").not("principal_protein", "is", null),
  ]);

  /*
   * Checked, because a failed count comes back as `count: null` and `?? 0` would turn a broken
   * query into "you have no recipes" — the shape that rendered "Nothing here yet" for a screen
   * querying columns the deployed database did not have. A number nobody could measure must not
   * read as a zero somebody measured.
   */
  for (const result of [total, mains, named]) {
    if (result.error) throw new Error(`counting this household's recipes: ${result.error.message}`);
  }
  if (total.count === null || mains.count === null || named.count === null) {
    throw new Error("counting this household's recipes: the count came back absent");
  }

  return { total: total.count, mains: mains.count, mainsNamingProtein: named.count };
}
