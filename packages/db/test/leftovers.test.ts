import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * A leftover: the meal that was already cooked, eaten on another day.
 *
 * Everything asserted here is enforced in the **database** rather than in a route, and that is
 * the point of the file. `times_made` is a trigger-maintained count, so a route cannot forget to
 * exclude a leftover from it; the chain refusal is a trigger, so a second write path cannot
 * create one; the tombstone is a trigger, so the leftover of a deleted meal cannot outlive it.
 * Each of these has a route-level equivalent that would have been easier and would have had to
 * be remembered at every call site.
 *
 * **Not** asserted here: that the shopping list excludes leftovers. That lives in
 * `buildShoppingWeek`'s query and is tested with its consolidation, because the failure there is
 * a number being wrong rather than a row being wrong.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("a leftover of a meal that was cooked", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  let recipeId: string;
  let planId: string;

  const timesMade = async () => {
    const { data } = await admin.from("recipes").select("times_made").eq("id", recipeId).single();
    return data?.times_made as number;
  };

  const cook = async (date: string, slot = "dinner") => {
    const made = await household.client
      .from("plan_entries")
      .insert({ family_id: household.familyId, meal_plan_id: planId, recipe_id: recipeId,
        date, scale: 1, slot })
      .select("id")
      .single();
    if (made.error) throw made.error;
    await admin.from("plan_entries").update({ cooked_at: new Date().toISOString() })
      .eq("id", made.data.id);
    return made.data.id as string;
  };

  /** as the household's own client, because a leftover logged by the service role proves nothing */
  const logLeftover = (parent: string, date: string, slot = "dinner") =>
    household.client
      .from("plan_entries")
      .insert({ family_id: household.familyId, meal_plan_id: planId, recipe_id: recipeId,
        date, scale: 1, slot, leftover_of: parent })
      .select("id")
      .single();

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "leftovers", entitled: true,
    });
    const recipe = await household.client
      .from("recipes")
      .insert({ family_id: household.familyId, title: "Big tray lasagne", status: "active",
        visibility: "private", servings: 6 })
      .select("id")
      .single();
    if (recipe.error) throw recipe.error;
    recipeId = recipe.data.id;

    const plan = await household.client
      .from("meal_plans")
      .insert({ family_id: household.familyId, week_start: "2026-03-02" })
      .select("id")
      .single();
    if (plan.error) throw plan.error;
    planId = plan.data.id;
  });

  afterAll(async () => {
    if (!instance) return;
    await deleteTestHousehold(admin, household);
  });

  it("is a meal a household can log for itself, not something only an operator can write", async () => {
    // a path that has only ever run with elevated privilege has not tested its permissions
    const parent = await cook("2026-03-03");
    const spare = await logLeftover(parent, "2026-03-05", "lunch");
    expect(spare.error, JSON.stringify(spare.error)).toBeNull();
    expect(spare.data?.id).toBeTruthy();
  });

  it("does not count as a second making, because it was cooked once", async () => {
    /*
     * The whole reason the exclusion is in `recount_times_made` rather than in a route: the
     * trigger fires on insert, on cooked_at, on deleted_at and on recipe_id, so there is no path
     * — marking, unmarking, deleting, restoring, moving — that can reach the count without it.
     */
    const before = await timesMade();
    const parent = await cook("2026-03-04");
    expect(await timesMade(), "a cooked meal counts").toBe(before + 1);

    const spare = await logLeftover(parent, "2026-03-06", "lunch");
    expect(spare.error).toBeNull();
    expect(await timesMade(), "eating it again is not cooking it again").toBe(before + 1);

    // and marking the leftover itself as eaten still does not
    await admin.from("plan_entries").update({ cooked_at: new Date().toISOString() })
      .eq("id", spare.data!.id);
    expect(await timesMade(), "recording that it was eaten is not a making").toBe(before + 1);
  });

  it("points at a meal that was cooked — a leftover of a leftover is refused", async () => {
    const parent = await cook("2026-03-07");
    const spare = await logLeftover(parent, "2026-03-08", "lunch");
    expect(spare.error).toBeNull();

    const chained = await logLeftover(spare.data!.id, "2026-03-08", "dinner");
    expect(chained.error, "a chain is the first step towards a portions model").not.toBeNull();
    expect(chained.error?.message).toMatch(/not at another leftover/);
  });

  it("cannot be logged twice onto the same meal at the same slot", async () => {
    // the ordinary duplicate — the same recipe twice in a day — stays possible and is answered
    // by the route with an offer to feed more people. A leftover has no quantity to raise, so
    // the second tap is refused instead.
    const parent = await cook("2026-03-09");
    const first = await logLeftover(parent, "2026-03-11", "lunch");
    expect(first.error).toBeNull();

    const again = await logLeftover(parent, "2026-03-11", "lunch");
    expect(again.error, "one leftover of one meal per slot").not.toBeNull();

    const otherSlot = await logLeftover(parent, "2026-03-11", "dinner");
    expect(otherSlot.error, "lunch and dinner on one day are two meals").toBeNull();
  });

  it("goes when the meal it came from goes, with the parent's exact timestamp", async () => {
    /*
     * `ON DELETE CASCADE` is declared on the FK and **does not fire on a soft delete** — every
     * deletion a person performs here is an UPDATE setting `deleted_at`. Without the propagation
     * trigger a tombstoned cook keeps a live leftover pointing at it, which is the recipe that
     * kept its plan entries and went on buying ingredients.
     */
    const parent = await cook("2026-03-12");
    const spare = await logLeftover(parent, "2026-03-14", "lunch");
    expect(spare.error).toBeNull();

    const when = new Date().toISOString();
    await admin.from("plan_entries").update({ deleted_at: when }).eq("id", parent);

    const { data } = await admin
      .from("plan_entries")
      .select("id, deleted_at")
      .in("id", [parent, spare.data!.id]);
    const stamps = (data ?? []).map((row) => row.deleted_at);
    expect(stamps.every((stamp) => stamp !== null), "the leftover went too").toBe(true);
    expect(new Set(stamps).size, "the same instant, which is what makes an undelete readable").toBe(1);
  });

  it("can be taken off a day without unmaking the meal it came from", async () => {
    // the asymmetry that makes the tombstone correct rather than merely tidy: cancelling
    // Thursday's reheat is a real action and must not touch Tuesday's dinner
    const parent = await cook("2026-03-16");
    const spare = await logLeftover(parent, "2026-03-18", "lunch");
    expect(spare.error).toBeNull();

    await household.client
      .from("plan_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", spare.data!.id);

    const { data } = await admin
      .from("plan_entries").select("deleted_at").eq("id", parent).single();
    expect(data?.deleted_at, "the cook is untouched").toBeNull();
  });

  it("cannot be re-pointed at a different meal once it is logged", async () => {
    /*
     * INSERT without UPDATE on `leftover_of`, the same grant shape `family_id` carries (§26). A
     * column a client cannot write is a question it cannot answer wrongly — and moving a
     * leftover's *day* is the feature, which its own grants already allow.
     */
    const parent = await cook("2026-03-19");
    const other = await cook("2026-03-20");
    const spare = await logLeftover(parent, "2026-03-21", "lunch");
    expect(spare.error).toBeNull();

    const moved = await household.client
      .from("plan_entries")
      .update({ leftover_of: other })
      .eq("id", spare.data!.id);
    expect(moved.error, "re-pointing a leftover is not a client's to do").not.toBeNull();

    const movedDay = await household.client
      .from("plan_entries")
      .update({ date: "2026-03-22" })
      .eq("id", spare.data!.id);
    expect(movedDay.error, "but moving it to another day is").toBeNull();
  });
});
