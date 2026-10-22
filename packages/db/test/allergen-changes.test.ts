import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * Who changed what this household avoids — the question §87 could not answer.
 *
 * The list held `["peanut","wheat"]` on 17 October and was empty when anyone looked. The cause was
 * found; the hand was not, because `updated_at` had been overwritten by a later write and Postgres
 * keeps no history of a column. So: a log, written by a **trigger on the column** rather than by
 * the route that is supposed to change allergens — because the write that caused §87 came from a
 * route doing something else entirely, and a log in the obvious place would have recorded nothing.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("the allergen change log", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "allergen-log", entitled: true,
    });
    const seeded = await admin
      .from("families")
      .update({ avoided_allergens: ["peanut", "wheat"] })
      .eq("id", household.familyId);
    if (seeded.error) throw seeded.error;
  }, 60_000);

  afterAll(async () => {
    if (instance && household) await deleteTestHousehold(admin, household);
  });

  const logFor = async () =>
    (
      await admin
        .from("allergen_changes")
        .select("allergen, action, changed_by, changed_at")
        .eq("family_id", household.familyId)
        .order("changed_at", { ascending: true })
    ).data ?? [];

  it("records who removed an allergen, and removes only that one", async () => {
    /*
     * Measured as a delta over the log rather than by searching it for an allergen, because the
     * setup's own `update` to seed `["peanut","wheat"]` is itself a change and the trigger duly
     * logged it as two additions. A first version searched for "peanut" and found that addition.
     * The trigger was right and the assertion was reading the wrong row — which is what a log
     * that records *every* write looks like from a test that assumed it records only its own.
     */
    const before = (await logFor()).length;

    const { data, error } = await admin.rpc("change_avoided_allergen", {
      p_family_id: household.familyId,
      p_allergen: "peanut",
      p_action: "remove",
      p_actor: household.accountId,
    });
    expect(error?.message ?? null).toBeNull();
    expect(data).toEqual(["wheat"]);

    const added = (await logFor()).slice(before);
    expect(added.length, "one change, one row").toBe(1);
    expect(added[0]?.allergen).toBe("peanut");
    expect(added[0]?.action).toBe("removed");
    expect(added[0]?.changed_by).toBe(household.accountId);
  });

  /*
   * The whole reason this is a trigger. A bare UPDATE is what a migration, a console, or a route
   * doing something else writes — and the §87 write was exactly that: a path nobody was watching.
   */
  // regression: the write that emptied a real allergen list came from a path with no logging
  it("records a change made by a path that never heard of the log", async () => {
    const before = (await logFor()).length;
    const { error } = await admin
      .from("families")
      .update({ avoided_allergens: [] })
      .eq("id", household.familyId);
    expect(error?.message ?? null).toBeNull();

    const log = await logFor();
    expect(log.length, "the bare UPDATE went unrecorded").toBeGreaterThan(before);
    const last = log.at(-1);
    expect(last?.allergen).toBe("wheat");
    expect(last?.action).toBe("removed");
    /*
     * And unattributed rather than falsely attributed. The actor is stamped transaction-locally
     * and **cleared** by the function, which the first probe of this table proved is not
     * optional: without the clear, this bare UPDATE inherited the actor of an earlier RPC in the
     * same transaction and was logged as that person's doing. A wrong name in an audit log is
     * worse than no name, because no name is visibly unknown and a wrong one is not.
     */
    expect(last?.changed_by).toBeNull();
  });

  it("gives each change its own moment, so the order is recoverable", async () => {
    await admin.rpc("change_avoided_allergen", {
      p_family_id: household.familyId, p_allergen: "sesame", p_action: "add", p_actor: household.accountId,
    });
    await admin.rpc("change_avoided_allergen", {
      p_family_id: household.familyId, p_allergen: "soy", p_action: "add", p_actor: household.accountId,
    });
    const log = await logFor();
    const stamps = log.map((row) => row.changed_at);
    /*
     * `clock_timestamp()` rather than `now()`. The default was `now()` first, which is transaction
     * time, and the first probe returned four rows with one identical stamp — a log whose rows
     * cannot be ordered answers "what changed" and not "what happened when".
     */
    expect(new Set(stamps).size, `${stamps.length} changes share ${new Set(stamps).size} timestamp(s)`)
      .toBe(stamps.length);
  });

  it("deduplicates and sorts, so adding twice is not two entries in the list", async () => {
    const { data } = await admin.rpc("change_avoided_allergen", {
      p_family_id: household.familyId, p_allergen: "soy", p_action: "add", p_actor: household.accountId,
    });
    expect(data).toEqual(["sesame", "soy"]);
  });

  it("refuses an action that is not add or remove", async () => {
    const { error } = await admin.rpc("change_avoided_allergen", {
      p_family_id: household.familyId, p_allergen: "peanut", p_action: "toggle", p_actor: null,
    });
    expect(error, "an unknown action was accepted").not.toBeNull();
  });

  it("refuses a household that is not there", async () => {
    const { error } = await admin.rpc("change_avoided_allergen", {
      p_family_id: "00000000-0000-0000-0000-000000000000",
      p_allergen: "peanut", p_action: "add", p_actor: null,
    });
    expect(error, "a missing household was accepted").not.toBeNull();
  });

  /*
   * The log is not reachable from the app, and the control is the point: a read that fails because
   * the table name is wrong looks exactly like a read that fails because it is forbidden.
   */
  it("is unreadable by a signed-in member, who has no screen for it", async () => {
    const control = await household.client
      .from("families")
      .select("id")
      .eq("id", household.familyId)
      .maybeSingle();
    expect(control.error?.message ?? null, "the control read failed, so the refusal proves nothing")
      .toBeNull();

    const { error } = await household.client
      .from("allergen_changes")
      .select("allergen")
      .eq("family_id", household.familyId);
    expect(error, "a member could read who changed a safety setting").not.toBeNull();
  });

  it("is unwritable by a signed-in member, so the log cannot be edited by its subject", async () => {
    const { error } = await household.client.from("allergen_changes").insert({
      family_id: household.familyId,
      allergen: "invented",
      action: "added",
    });
    expect(error, "a member could write a row into the audit log").not.toBeNull();
  });
});
