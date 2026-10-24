import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * Which group an item is in — standing, across every week.
 *
 * The table exists because a group is a property of the **item** and `shopping_extras.group_id`
 * could only ever say it about one request. Everything here runs as the **household**, not as the
 * service role, because the service role bypasses RLS and would test that privilege can skip the
 * column grants rather than that the grants are right.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("where a household buys an item", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  let costco: string;
  let heb: string;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "itemgroups", entitled: true,
    });
    for (const name of ["Costco", "HEB"]) {
      const { data } = await household.client.from("shopping_groups")
        .insert({ family_id: household.familyId, name, created_by: household.memberId })
        .select("id").single();
      if (name === "Costco") costco = data!.id; else heb = data!.id;
    }
  }, 60_000);

  afterAll(async () => {
    if (instance && household) await deleteTestHousehold(admin, household);
  });

  const file = (itemKey: string, groupId: string) =>
    household.client.from("shopping_item_groups")
      .insert({ family_id: household.familyId, item_key: itemKey, group_id: groupId })
      .select("id").maybeSingle();

  it("lets the household file an item without the service role", async () => {
    const { data, error } = await file("ground-beef", costco);
    expect(error?.message ?? null, "the household could not file its own item").toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("refuses a second live row for the same item", async () => {
    await file("butter", costco);
    const { error } = await file("butter", heb);
    expect(error, "one item was filed under two groups at once").not.toBeNull();
  });

  /*
   * The operation a person performs is "put this item in that group", which is `group_id`. Moving a
   * row to another *key* would silently regroup a different item, so the column carries no UPDATE
   * grant — and column grants are invisible to RLS, which is why this is asserted rather than
   * assumed (§26).
   */
  it("refuses to let a client move an assignment to a different item", async () => {
    const { data } = await file("jasmine-rice", costco);
    const moved = await household.client.from("shopping_item_groups")
      .update({ item_key: "basmati-rice" }).eq("id", data!.id);
    expect(moved.error, "a client rewrote which item an assignment is about").not.toBeNull();
    const regrouped = await household.client.from("shopping_item_groups")
      .update({ group_id: heb }).eq("id", data!.id).select("group_id").maybeSingle();
    expect(regrouped.error?.message ?? null, "the household could not change where it buys rice").toBeNull();
    expect(regrouped.data?.group_id).toBe(heb);
  });

  it("files it again after it has been taken out of a group", async () => {
    const { data } = await file("paper-towels", costco);
    const out = await household.client.from("shopping_item_groups")
      .update({ deleted_at: new Date().toISOString() }).eq("id", data!.id).select("id").maybeSingle();
    expect(out.error?.message ?? null).toBeNull();
    // the unique index excludes tombstones, so this must not collide with the row just retired
    const again = await file("paper-towels", heb);
    expect(again.error?.message ?? null, "an item could not be regrouped after being ungrouped").toBeNull();
  });

  /*
   * Deleting a label forgets where the item was bought, and that differs from `shopping_extras` on
   * purpose: an extra is a **thing to buy** and must outlive its label, whereas an assignment *is*
   * the label. The item is untouched either way, because the item is not stored here.
   */
  it("forgets the assignment when the group is deleted, and keeps the thing to buy", async () => {
    const doomed = await household.client.from("shopping_groups")
      .insert({ family_id: household.familyId, name: "Doomed Depot", created_by: household.memberId })
      .select("id").single();
    const assignment = await file("fun-size-chocolate", doomed.data!.id);
    const extra = await household.client.from("shopping_extras").insert({
      family_id: household.familyId, week_start: "2026-10-26",
      raw_text: "fun size chocolate", added_by: household.memberId, group_id: doomed.data!.id,
    }).select("id").single();

    await household.client.from("shopping_groups")
      .update({ deleted_at: new Date().toISOString() }).eq("id", doomed.data!.id);

    const after = await admin.from("shopping_item_groups")
      .select("deleted_at").eq("id", assignment.data!.id).single();
    expect(after.data?.deleted_at, "the assignment outlived the group it names").not.toBeNull();
    const item = await admin.from("shopping_extras")
      .select("deleted_at, group_id").eq("id", extra.data!.id).single();
    expect(item.data?.deleted_at, "deleting a label deleted the thing to buy").toBeNull();
    expect(item.data?.group_id, "the item kept a deleted group").toBeNull();
  });

  it("refuses to file an item into another household's group", async () => {
    const other = await createTestHousehold({
      admin, url: instance!.url, anonKey: instance!.anonKey, label: "itemgroups-other", entitled: true,
    });
    try {
      const theirs = await other.client.from("shopping_groups")
        .insert({ family_id: other.familyId, name: "Their Shop", created_by: other.memberId })
        .select("id").single();
      const { error } = await file("stolen-beef", theirs.data!.id);
      expect(error, "an item was filed into another household's group").not.toBeNull();
    } finally {
      await deleteTestHousehold(admin, other);
    }
  });
});
