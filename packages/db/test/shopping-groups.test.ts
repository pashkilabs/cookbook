import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * Groups a household makes, and the normalisation that keeps them from doubling.
 *
 * **The cases are Paige's real headers**, not invented ones: COSTCO, Trader Joes and Boo Basket,
 * plus the HEB spellings Stephen named. Case, punctuation, whitespace and a trailing plural are
 * not a fuzzy-matching problem — they must be one group before any threshold is consulted.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("the household's shopping groups", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "groups", entitled: true,
    });
  }, 60_000);

  afterAll(async () => {
    if (instance && household) await deleteTestHousehold(admin, household);
  });

  const make = (name: string, extra: Record<string, unknown> = {}) =>
    household.client.from("shopping_groups").insert({
      family_id: household.familyId, name, created_by: household.memberId, ...extra,
    }).select("id, name").maybeSingle();

  it("refuses a second group whose name differs only by case, punctuation or a plural", async () => {
    const first = await make("Costco");
    expect(first.error?.message ?? null).toBeNull();
    for (const twin of ["COSTCO", "costco", " costco ", "Costcos", "co-stco"]) {
      const { error } = await make(twin);
      expect(error, `"${twin}" was accepted as a second group`).not.toBeNull();
    }
  });

  // the brief's canonical HIGH CONFIDENCE fuzzy example — which normalisation settles exactly
  it("treats Trader Joe's and Trader Joes as one group without a threshold", async () => {
    const first = await make("Trader Joes");
    expect(first.error?.message ?? null).toBeNull();
    const { error } = await make("Trader Joe's");
    expect(error, "the apostrophe made a second group").not.toBeNull();
  });

  it("treats HEB, H-E-B and H.E.B. as one group", async () => {
    expect((await make("H-E-B")).error?.message ?? null).toBeNull();
    for (const twin of ["HEB", "H.E.B.", "heb"]) {
      expect((await make(twin)).error, `"${twin}" made a second group`).not.toBeNull();
    }
  });

  it("keeps the spelling the creator typed, since normalisation is only for matching", async () => {
    const made = await make("Boo Basket");
    expect(made.data?.name).toBe("Boo Basket");
  });

  /*
   * There is deliberately no test here comparing the TypeScript rule to the SQL one directly.
   *
   * The first version tried, could not read an index expression back through PostgREST, and ended
   * as `expect(inTypeScript(name)).toBe(inTypeScript(name))` — a value compared with itself, which
   * passes forever and asserts nothing. That is the shape this repo keeps a list of, written by
   * the person keeping the list.
   *
   * The agreement is asserted **behaviourally** instead, by the three tests above: each inserts the
   * twins and requires the database to refuse them. If the SQL rule stopped folding apostrophes or
   * plurals, those fail. That is the property worth holding, and it is held by the database rather
   * than by a string comparison.
   */

  /*
   * Deleting a label must never delete a thing to buy. `nullify` propagation, the mode written for
   * "removing a person must not remove the household's recipes, it must forget who wrote them".
   */
  it("keeps an item on the list when its group is deleted, and forgets the group", async () => {
    const group = await make("Doomed");
    const extra = await household.client
      .from("shopping_extras")
      .insert({
        family_id: household.familyId,
        week_start: "2026-10-19",
        raw_text: "paper towels",
        added_by: household.memberId,
        group_id: group.data!.id,
      })
      .select("id")
      .single();
    expect(extra.error?.message ?? null).toBeNull();

    /*
     * As the **household**, not as admin, and that is the point of the test rather than tidiness.
     *
     * The first version used the service role, which bypasses RLS and is not what `/household`
     * does — so the `update (deleted_at)` grant and the nullify trigger running as `authenticated`
     * had never been exercised, and a permission nothing has exercised is a permission you do not
     * have. The route uses a user client; so does this.
     */
    const removed = await household.client
      .from("shopping_groups")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", group.data!.id)
      .select("id")
      .maybeSingle();
    expect(removed.error?.message ?? null, "the household could not remove its own group").toBeNull();
    expect(removed.data?.id, "the delete matched no row").toBe(group.data!.id);

    const after = await admin
      .from("shopping_extras")
      .select("group_id, deleted_at")
      .eq("id", extra.data!.id)
      .single();
    expect(after.data?.deleted_at, "deleting a label deleted the thing to buy").toBeNull();
    expect(after.data?.group_id, "the item kept a deleted group").toBeNull();
  });

  /*
   * The property free text cannot have, and the whole reason this is a table.
   *
   * Renaming a string means finding every copy of it and rewriting them; miss one and the group
   * silently splits in two. Here the item points at the row, so the name changes underneath it and
   * nothing is orphaned — which is what `/household`'s rename control relies on.
   */
  it("keeps every item in a group when the group is renamed", async () => {
    const group = await make("Costcoo");
    const extra = await household.client
      .from("shopping_extras")
      .insert({
        family_id: household.familyId,
        week_start: "2026-10-19",
        raw_text: "rotisserie chicken",
        added_by: household.memberId,
        group_id: group.data!.id,
      })
      .select("id")
      .single();
    expect(extra.error?.message ?? null).toBeNull();

    const renamed = await household.client
      .from("shopping_groups")
      .update({ name: "Costco warehouse" })
      .eq("id", group.data!.id)
      .select("name")
      .single();
    expect(renamed.error?.message ?? null).toBeNull();
    expect(renamed.data?.name).toBe("Costco warehouse");

    const after = await household.client
      .from("shopping_extras")
      .select("group_id, shopping_groups(name)")
      .eq("id", extra.data!.id)
      .single();
    expect(after.data?.group_id, "the rename orphaned the item").toBe(group.data!.id);
    expect((after.data as { shopping_groups?: { name?: string } }).shopping_groups?.name)
      .toBe("Costco warehouse");
  });

  it("keeps a group when the member who made it is removed", async () => {
    const group = await make("Outlives its maker");
    expect(group.error?.message ?? null).toBeNull();
    await admin.from("family_members").update({ deleted_at: new Date().toISOString() })
      .eq("id", household.memberId);
    const after = await admin
      .from("shopping_groups")
      .select("deleted_at, created_by")
      .eq("id", group.data!.id)
      .single();
    // the household still shops at Costco when somebody leaves: forget the maker, keep the group
    expect(after.data?.deleted_at).toBeNull();
    expect(after.data?.created_by).toBeNull();
    await admin.from("family_members").update({ deleted_at: null }).eq("id", household.memberId);
  });
});
