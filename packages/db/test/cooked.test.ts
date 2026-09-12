import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * Recording that a meal was cooked, and the count that follows from it.
 *
 * `plan_entries.cooked_at` existed from the first migration and was never written; `times_made`
 * was displayed in four places and incremented nowhere, so every recipe read "untried" forever.
 * The event is the truth now and the count is a cache of it.
 *
 * These exercise the paths a `+1/-1` scheme would forget — unmarking, soft-deleting a cooked
 * entry, restoring it — which is why the trigger recounts instead of adding.
 */
const instance = readLocalInstance();
const NO_PRIVILEGE = "42501";

describe.skipIf(instance === null)("a meal recorded as cooked", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  let recipeId: string;
  let planId: string;

  const timesMade = async () => {
    const { data } = await admin.from("recipes").select("times_made").eq("id", recipeId).single();
    return data?.times_made as number;
  };

  const planIt = async (date: string) => {
    const made = await household.client
      .from("plan_entries")
      .insert({ family_id: household.familyId, meal_plan_id: planId, recipe_id: recipeId,
        date, scale: 1, slot: "dinner" })
      .select("id")
      .single();
    if (made.error) throw made.error;
    return made.data.id as string;
  };

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "cooked", entitled: true,
    });
    const recipe = await household.client
      .from("recipes")
      .insert({ family_id: household.familyId, title: "Weeknight dal", status: "active",
        visibility: "private", servings: 4 })
      .select("id")
      .single();
    if (recipe.error) throw recipe.error;
    recipeId = recipe.data.id;

    const plan = await household.client
      .from("meal_plans")
      .insert({ family_id: household.familyId, week_start: "2026-09-07" })
      .select("id")
      .single();
    if (plan.error) throw plan.error;
    planId = plan.data.id;
  });

  afterAll(async () => {
    if (!instance) return;
    await deleteTestHousehold(admin, household);
  });

  it("starts at nothing, and planning a meal is not cooking it", async () => {
    // the distinction the whole feature rests on: an intention is not a meal
    const entry = await planIt("2026-09-08");
    expect(await timesMade()).toBe(0);
    expect(entry).toBeTruthy();
  });

  it("counts once the household says it cooked it", async () => {
    const entry = await planIt("2026-09-09");
    const { error } = await household.client
      .from("plan_entries")
      .update({ cooked_at: new Date().toISOString() })
      .eq("id", entry);
    expect(error).toBeNull();
    expect(await timesMade()).toBe(1);
  });

  it("counts a second night separately, because each meal is its own event", async () => {
    const entry = await planIt("2026-09-10");
    await household.client.from("plan_entries").update({ cooked_at: new Date().toISOString() }).eq("id", entry);
    expect(await timesMade()).toBe(2);
  });

  it("goes back down when a household unmarks it", async () => {
    // marked by mistake, on the wrong night — undoing has to be as real as doing
    const entry = await planIt("2026-09-11");
    await household.client.from("plan_entries").update({ cooked_at: new Date().toISOString() }).eq("id", entry);
    expect(await timesMade()).toBe(3);
    await household.client.from("plan_entries").update({ cooked_at: null }).eq("id", entry);
    expect(await timesMade()).toBe(2);
  });

  it("stops counting a cooked meal that is removed from the plan", async () => {
    /*
     * The path arithmetic forgets. Removing a meal is an UPDATE setting deleted_at — `ON DELETE
     * CASCADE does not fire on a soft delete` — so a +1/-1 scheme would leave the count standing
     * on a row nobody can see.
     */
    const entry = await planIt("2026-09-12");
    await household.client.from("plan_entries").update({ cooked_at: new Date().toISOString() }).eq("id", entry);
    expect(await timesMade()).toBe(3);
    await household.client.from("plan_entries").update({ deleted_at: new Date().toISOString() }).eq("id", entry);
    expect(await timesMade()).toBe(2);
  });

  it("counts it again if the removal is undone", async () => {
    const entry = await planIt("2026-09-13");
    await household.client.from("plan_entries").update({ cooked_at: new Date().toISOString() }).eq("id", entry);
    const before = await timesMade();
    await household.client.from("plan_entries").update({ deleted_at: new Date().toISOString() }).eq("id", entry);
    await admin.from("plan_entries").update({ deleted_at: null }).eq("id", entry);
    expect(await timesMade()).toBe(before);
  });

  it("does not let a household write the count directly", async () => {
    // §26: derived means derived. A writable copy can disagree with the meals behind it, which
    // is precisely how the old number came to say "untried" about everything
    const { error } = await household.client
      .from("recipes").update({ times_made: 99 }).eq("id", recipeId);
    expect(error?.code).toBe(NO_PRIVILEGE);
  });
});
