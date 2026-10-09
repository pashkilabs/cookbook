import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * What a person has SAID they like and dislike (§71, piece 2).
 *
 * Cleanup goes through the service role, not the household client: **clients hold no DELETE**
 * here, because every deletion in this schema is an UPDATE setting `deleted_at`. The first
 * version of this file tidied up with `household.client.delete()`, which was silently refused —
 * so the rows stayed and the next insert failed on the unique index with 23505. The denial was
 * correct and the test was wrong.
 *
 * Three things are tested because they are what the design rests on rather than what the schema
 * happens to express: one live stance per subject (so a like and a dislike cannot coexist for a
 * resolver to break), a client that may change its mind but never reattribute a statement, and a
 * departed member taking their preferences with them.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("stated preferences", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  const preference = (extra: Record<string, unknown> = {}) => ({
    family_id: household.familyId,
    family_member_id: household.memberId,
    stance: "dislike",
    subject_kind: "ingredient",
    subject: "mushroom",
    ...extra,
  });

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "prefs", entitled: true,
    });
  }, 60_000);

  afterAll(async () => {
    if (instance && household) await deleteTestHousehold(admin, household);
  });

  it("records what somebody said, and reads it back", async () => {
    const made = await household.client.from("member_preferences").insert(preference()).select("id, stance").single();
    expect(made.error).toBeNull();
    expect(made.data?.stance).toBe("dislike");
    await admin.from("member_preferences").delete().eq("id", made.data!.id);
  });

  it("refuses a stance that is not like or dislike, so a scale cannot arrive as data", async () => {
    const made = await household.client
      .from("member_preferences")
      .insert(preference({ stance: "sort of" }))
      .select("id");
    expect(made.error).not.toBeNull();
  });

  it("refuses a blank subject, which would be a preference about nothing", async () => {
    const made = await household.client
      .from("member_preferences")
      .insert(preference({ subject: "   " }))
      .select("id");
    expect(made.error).not.toBeNull();
  });

  /*
   * `stance` is deliberately not in the unique key, so changing your mind is an UPDATE and not a
   * second row. That is what makes the contradiction impossible rather than merely discouraged.
   */
  it("holds one live stance per subject, so a like and a dislike cannot coexist", async () => {
    const first = await household.client.from("member_preferences").insert(preference()).select("id").single();
    expect(first.error).toBeNull();

    const second = await household.client
      .from("member_preferences")
      .insert(preference({ stance: "like" }))
      .select("id");
    expect(second.error).not.toBeNull();

    const changed = await household.client
      .from("member_preferences")
      .update({ stance: "like" })
      .eq("id", first.data!.id)
      .select("stance")
      .single();
    expect(changed.data?.stance).toBe("like");

    await admin.from("member_preferences").delete().eq("id", first.data!.id);
  });

  // §26: a policy decides which rows are reachable, a grant decides what a row may assert
  it("lets a client change its mind but never reattribute the statement", async () => {
    const made = await household.client.from("member_preferences").insert(preference()).select("id").single();
    const moved = await household.client
      .from("member_preferences")
      .update({ family_member_id: household.memberId, family_id: household.familyId })
      .eq("id", made.data!.id)
      .select("id");
    expect(moved.error).not.toBeNull();
    await admin.from("member_preferences").delete().eq("id", made.data!.id);
  });

  it("refuses to name a member of another household", async () => {
    const other = await createTestHousehold({
      admin, url: instance!.url, anonKey: instance!.anonKey, label: "prefs-other", entitled: true,
    });
    try {
      // the composite FK is the household check: without it a preference could claim a member
      // whose household it is not in
      const made = await household.client
        .from("member_preferences")
        .insert(preference({ family_member_id: other.memberId }))
        .select("id");
      expect(made.error).not.toBeNull();
    } finally {
      await deleteTestHousehold(admin, other);
    }
  }, 60_000);

  it("takes a departed member's preferences with them, and gives them back on restore", async () => {
    const made = await household.client.from("member_preferences").insert(preference()).select("id").single();
    expect(made.error).toBeNull();

    // the trigger, not the FK: ON DELETE CASCADE does not fire on an UPDATE setting deleted_at
    await admin.from("family_members").update({ deleted_at: new Date().toISOString() }).eq("id", household.memberId);
    const gone = await admin.from("member_preferences").select("deleted_at").eq("id", made.data!.id).single();
    expect(gone.data?.deleted_at).not.toBeNull();

    await admin.from("family_members").update({ deleted_at: null }).eq("id", household.memberId);
    const back = await admin.from("member_preferences").select("deleted_at").eq("id", made.data!.id).single();
    expect(back.data?.deleted_at).toBeNull();

    await admin.from("member_preferences").delete().eq("id", made.data!.id);
  });

  it("is unreachable as anon — a household's stated preferences are personal data", async () => {
    const anon = createClient(instance!.url, instance!.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const read = await anon.from("member_preferences").select("stance");
    expect(read.error ?? read.data?.length === 0).toBeTruthy();
  });
});
