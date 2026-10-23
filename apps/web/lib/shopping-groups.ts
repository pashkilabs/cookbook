import type { SupabaseClient } from "@supabase/supabase-js";
import { rows } from "./rows";

export interface ShoppingGroup {
  id: string;
  name: string;
}

/**
 * The groups a household has made — Costco, HEB, Trader Joes, Boo Basket.
 *
 * Not stores: "Boo Basket" is a Halloween gift basket and a `store` field would either drop that
 * group or lie about it (§91).
 */
export async function listGroups(
  supabase: SupabaseClient,
  familyId: string,
): Promise<ShoppingGroup[]> {
  return rows(
    await supabase
      .from("shopping_groups")
      .select("id, name")
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .order("name"),
    "this household's shopping groups",
  ).map((row) => ({ id: row.id as string, name: row.name as string }));
}

/**
 * Normalise a group name for comparison — the same rule the database's unique index applies.
 *
 * **Case, punctuation, whitespace and a trailing plural are not a fuzzy-matching problem.**
 * "COSTCO", "Costco" and "costco" are one group and must never reach a matcher; so are "HEB",
 * "H-E-B" and "H.E.B.". Measured against the real headers, this also folds "Trader Joe's" into
 * "Trader Joes" — which was offered as the canonical *fuzzy* example and turns out to be an exact
 * match once punctuation is gone.
 *
 * Duplicated here and in `private.normalise_group_name` deliberately: the database owns the
 * constraint, because a UI that remembers to normalise is a UI that will one day forget, and this
 * copy exists so a route can *find* the existing group rather than merely be refused by the index.
 * The two must agree — `packages/db/test/shopping-groups.test.ts` asserts they do against the same
 * cases.
 */
export const normaliseGroupName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "");

/**
 * Find or make a group for a name somebody typed.
 *
 * **A collision is not an error.** Somebody typing a group that exists means *that group*, so this
 * returns it and says which happened — the screen says "Added to Costco" rather than refusing a
 * duplicate. The unique index on the normalised name is what makes the race safe: two tabs typing
 * "costco" and "Costco" cannot produce two rows, and the loser reads the winner's.
 *
 * The stored name is **what the creator typed**. The normalised form is only ever for matching, so
 * "HEB" keeps its spelling until somebody renames it.
 */
export async function findOrCreateGroup(
  supabase: SupabaseClient,
  familyId: string,
  memberId: string,
  name: string,
): Promise<{ group: ShoppingGroup; created: boolean } | { error: string }> {
  const typed = name.trim();
  if (!typed) return { error: "a group needs a name" };
  if (typed.length > 60) return { error: "that is longer than a group name needs to be" };

  const normalised = normaliseGroupName(typed);
  if (!normalised) return { error: "a group name needs a letter or a number in it" };

  const existing = (await listGroups(supabase, familyId)).find(
    (group) => normaliseGroupName(group.name) === normalised,
  );
  if (existing) return { group: existing, created: false };

  const { data, error } = await supabase
    .from("shopping_groups")
    .insert({ family_id: familyId, name: typed, created_by: memberId })
    .select("id, name")
    .single();

  if (error) {
    /*
     * The index refused it, which means another writer created the same group between the read
     * above and this insert. Read theirs rather than reporting a failure: the person asked for a
     * group by that name and there is now one.
     */
    const now = (await listGroups(supabase, familyId)).find(
      (group) => normaliseGroupName(group.name) === normalised,
    );
    if (now) return { group: now, created: false };
    return { error: error.message };
  }
  return { group: { id: data.id as string, name: data.name as string }, created: true };
}

/**
 * How close two group names are, for the band a route puts a photographed header into.
 *
 * Levenshtein over the **normalised** forms, because everything punctuation-shaped is already an
 * exact match by the time this runs. What is left is genuine misspelling.
 */
export function similarity(a: string, b: string): number {
  const x = normaliseGroupName(a);
  const y = normaliseGroupName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) =>
    Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
  }
  return 1 - d[x.length]![y.length]! / Math.max(x.length, y.length);
}

/**
 * The groups, each with how many things are in it — for the management screen.
 *
 * **A count per group rather than one read tallied in JS**, which is the version I wrote first.
 * PostgREST caps a collection at 1000 rows by default, so a tally over the returned rows
 * under-reports silently once a household passes it — and the number is not decoration here: the
 * delete confirmation says "the 4 things in it stay on the list", and the truncated version would
 * say "nothing is in it, so nothing moves" about a group holding forty. A wrong sentence on a
 * destructive control is worth N small exact counts, and N is the number of groups a household has
 * made.
 */
export async function listGroupsWithCounts(
  supabase: SupabaseClient,
  familyId: string,
): Promise<(ShoppingGroup & { items: number })[]> {
  const groups = await listGroups(supabase, familyId);
  return Promise.all(
    groups.map(async (group) => {
      const { count } = await supabase
        .from("shopping_extras")
        .select("id", { count: "exact", head: true })
        .eq("family_id", familyId)
        .eq("group_id", group.id)
        .is("deleted_at", null);
      return { ...group, items: count ?? 0 };
    }),
  );
}
