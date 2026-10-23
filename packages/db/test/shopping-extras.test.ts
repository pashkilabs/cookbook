import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * Things typed onto a week's shopping list (§89).
 *
 * The design decisions worth asserting are all about what the table *refuses* and what it lets a
 * client write: the week scoping that makes clearing a non-problem, the attribution that cannot be
 * forged or edited afterwards, and the column grants that stop a client stamping its own
 * timestamps (§26).
 */
const instance = readLocalInstance();

describe("things added to the shopping list by hand", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "extras", entitled: true,
    });
  }, 60_000);

  afterAll(async () => {
    if (instance && household) await deleteTestHousehold(admin, household);
  });

  it.skipIf(instance === null)("a member can add one to their own household", async () => {
    const { data, error } = await household.client
      .from("shopping_extras")
      .insert({
        family_id: household.familyId,
        week_start: "2026-10-19",
        raw_text: "2 lemons",
        added_by: household.memberId,
      })
      .select("id, raw_text")
      .single();
    expect(error?.message ?? null).toBeNull();
    expect(data?.raw_text).toBe("2 lemons");
  });

  it.skipIf(instance === null)("refuses an empty line, which is a row nobody meant to create", async () => {
    for (const blank of ["", "   "]) {
      const { error } = await household.client.from("shopping_extras").insert({
        family_id: household.familyId,
        week_start: "2026-10-19",
        raw_text: blank,
        added_by: household.memberId,
      });
      expect(error, `${JSON.stringify(blank)} was accepted`).not.toBeNull();
    }
  });

  /*
   * Two people both asking for milk is two requests and one carton. The row keeps both, and
   * `consolidate` merges them at read time by catalog key — which is also what puts both names on
   * the line. A unique constraint here would have thrown away the second person.
   */
  it.skipIf(instance === null)("keeps two requests for the same thing, because two people asked", async () => {
    for (const _ of [1, 2]) {
      const { error } = await household.client.from("shopping_extras").insert({
        family_id: household.familyId,
        week_start: "2026-10-19",
        raw_text: "milk",
        added_by: household.memberId,
      });
      expect(error?.message ?? null).toBeNull();
    }
    const { data } = await household.client
      .from("shopping_extras")
      .select("id")
      .eq("family_id", household.familyId)
      .eq("raw_text", "milk")
      .is("deleted_at", null);
    expect(data?.length).toBe(2);
  });

  /*
   * The week scoping, which is the whole reason nothing has to clear these. A different week is a
   * different list, and last week's extras simply are not selected.
   */
  it.skipIf(instance === null)("belongs to one week and does not appear in the next", async () => {
    await household.client.from("shopping_extras").insert({
      family_id: household.familyId,
      week_start: "2026-10-26",
      raw_text: "next week only",
      added_by: household.memberId,
    });
    const thisWeek = await household.client
      .from("shopping_extras")
      .select("raw_text")
      .eq("family_id", household.familyId)
      .eq("week_start", "2026-10-19")
      .is("deleted_at", null);
    expect(thisWeek.data?.map((row) => row.raw_text)).not.toContain("next week only");
  });

  it.skipIf(instance === null)("refuses a member of another household as the asker", async () => {
    const other = await createTestHousehold({
      admin, url: instance!.url, anonKey: instance!.anonKey, label: "extras-other", entitled: true,
    });
    try {
      // the composite key is what makes this impossible: a reference between household tables
      // carries family_id, or a child can claim a household its parent is not in
      const { error } = await household.client.from("shopping_extras").insert({
        family_id: household.familyId,
        week_start: "2026-10-19",
        raw_text: "not yours",
        added_by: other.memberId,
      });
      expect(error, "another household's member was accepted as the asker").not.toBeNull();
    } finally {
      await deleteTestHousehold(admin, other);
    }
  }, 60_000);

  it.skipIf(instance === null)("cannot be reattributed after the fact", async () => {
    const made = await household.client
      .from("shopping_extras")
      .insert({
        family_id: household.familyId,
        week_start: "2026-10-19",
        raw_text: "who asked for this",
        added_by: household.memberId,
      })
      .select("id")
      .single();
    expect(made.error?.message ?? null).toBeNull();

    /*
     * No UPDATE grant on `added_by` — who asked for something is not editable, the same reasoning
     * the audit log takes one table along. A column grant is what enforces it: RLS says nothing
     * about columns, and a table-wide grant would let a client rewrite this (§26).
     */
    const { error } = await household.client
      .from("shopping_extras")
      .update({ added_by: household.memberId })
      .eq("id", made.data!.id);
    expect(error, "a client rewrote who asked for it").not.toBeNull();
  });

  it.skipIf(instance === null)("cannot stamp its own timestamps", async () => {
    const { error } = await household.client.from("shopping_extras").insert({
      family_id: household.familyId,
      week_start: "2026-10-19",
      raw_text: "forged",
      added_by: household.memberId,
      created_at: "2020-01-01T00:00:00Z",
    });
    expect(error, "a client set its own created_at").not.toBeNull();
  });

  /*
   * Propagation from the **member**, which is the one the invariant requires — and writing this
   * test is what found that the triggers on `families` could not run at all. They threw
   * `record "new" has no field "family_id"` on every household soft-delete, with no child rows
   * involved, because `propagate_soft_delete` is written for a trigger on a row carrying both
   * `id` and `family_id`. `cart_exports` had the shape first and `member_settings` copied it.
   *
   * A household is **not** soft-deleted by design: `assert_soft_delete_propagation` excludes
   * `families` by name — "deleting one is teardown, not editing" — and the FK cascades on a hard
   * delete. So the triggers were not merely broken, they made an unsupported operation an
   * erroring one.
   */
  // regression: propagation triggers on `families` threw on every household soft-delete
  it.skipIf(instance === null)("goes with the member who asked when they are removed, and comes back", async () => {
    const mine = await household.client
      .from("shopping_extras")
      .insert({
        family_id: household.familyId,
        week_start: "2026-10-19",
        raw_text: "goes with me",
        added_by: household.memberId,
      })
      .select("id")
      .single();
    expect(mine.error?.message ?? null).toBeNull();

    const stamp = new Date().toISOString();
    await admin.from("family_members").update({ deleted_at: stamp }).eq("id", household.memberId);
    const gone = await admin
      .from("shopping_extras")
      .select("deleted_at")
      .eq("id", mine.data!.id)
      .single();
    expect(gone.data?.deleted_at, "a removed member kept a live extra").not.toBeNull();
    /*
     * The parent's EXACT instant, which is what distinguishes an undelete from a child deleted on
     * its own — compared as a time rather than as a string, because Postgres writes `+00:00` where
     * JavaScript writes `Z` and the first version of this failed on the spelling of an instant it
     * had got right.
     */
    expect(new Date(gone.data!.deleted_at!).getTime()).toBe(new Date(stamp).getTime());

    await admin.from("family_members").update({ deleted_at: null }).eq("id", household.memberId);
    const back = await admin
      .from("shopping_extras")
      .select("deleted_at")
      .eq("id", mine.data!.id)
      .single();
    expect(back.data?.deleted_at, "restoring the member did not bring their extra back").toBeNull();
  });

  /*
   * And a household going away takes them with it — by hard delete and the FK's own cascade, which
   * is the documented position rather than a tombstone.
   */
  it.skipIf(instance === null)("is hard-deleted with its household, by the cascade", async () => {
    const doomed = await createTestHousehold({
      admin, url: instance!.url, anonKey: instance!.anonKey, label: "extras-doomed", entitled: true,
    });
    const made = await admin
      .from("shopping_extras")
      .insert({
        family_id: doomed.familyId,
        week_start: "2026-10-19",
        raw_text: "goes with the household",
        added_by: doomed.memberId,
      })
      .select("id")
      .single();
    expect(made.error?.message ?? null).toBeNull();

    await deleteTestHousehold(admin, doomed);

    const { data } = await admin.from("shopping_extras").select("id").eq("id", made.data!.id).maybeSingle();
    expect(data, "the extra outlived its household").toBeNull();
  }, 60_000);
});
