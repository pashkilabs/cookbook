import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * A soft delete has to reach the children, because `ON DELETE CASCADE` does not fire on an UPDATE.
 *
 * This was a live bug: clients have no DELETE privilege, so every deletion in the product is
 * `deleted_at`, and a tombstoned recipe kept its plan entries — still on the planner, still buying
 * ingredients on the shopping list.
 *
 * Written as service-role tests on purpose. The propagation is a database trigger precisely so it
 * does not depend on which caller performed the delete, and asserting it through the API would
 * test the route instead of the rule.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("soft delete propagation", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  let other: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "soft-delete",
    });
    other = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "soft-delete-other",
    });
  });

  afterAll(async () => {
    if (!instance) return;
    for (const target of [other, household].filter(Boolean)) {
      await deleteTestHousehold(admin, target);
    }
  });

  /**
   * A recipe with one of everything that hangs off it.
   *
   * Each gets its own week, because `meal_plans_one_per_week` is a partial unique index and a
   * shared week would make these tests depend on each other's order.
   */
  let weekCounter = 0;
  async function plantRecipe(family: TestHousehold, title: string) {
    weekCounter += 1;
    const weekStart = new Date(Date.UTC(2026, 0, 5 + weekCounter * 7)).toISOString().slice(0, 10);
    const recipe = await admin
      .from("recipes")
      .insert({
        family_id: family.familyId,
        title,
        source_name: null,
        source_url: null,
        servings: 4,
        time_minutes: 30,
        times_made: 0,
        status: "active",
        visibility: "private",
        make_again: null,
        created_by: family.memberId,
      })
      .select("id")
      .single();
    if (recipe.error) throw recipe.error;
    const recipeId = recipe.data.id as string;

    const plan = await admin
      .from("meal_plans")
      .insert({ family_id: family.familyId, week_start: weekStart })
      .select("id")
      .single();
    if (plan.error) throw plan.error;

    const writes = await Promise.all([
      admin.from("recipe_ingredients").insert({
        family_id: family.familyId, recipe_id: recipeId, position: 0, amount: 1, unit: "cup",
        item_text: "cream", note: "", is_estimated: false, ingredient_id: null,
      }),
      admin.from("recipe_steps").insert({
        family_id: family.familyId, recipe_id: recipeId, position: 0, text: "Stir.",
      }),
      admin.from("ratings").insert({
        family_id: family.familyId, recipe_id: recipeId, family_member_id: family.memberId,
        score: 5, rated_at: new Date().toISOString(),
      }),
      admin.from("photos").insert({
        family_id: family.familyId, recipe_id: recipeId,
        storage_path: `${family.familyId}/${recipeId}.jpg`, source: "camera", upload_state: "stored",
        width: 100, height: 100,
      }),
      admin.from("shortlist_entries").insert({
        family_id: family.familyId, week_start: weekStart, recipe_id: recipeId,
      }),
      admin.from("plan_entries").insert({
        family_id: family.familyId, meal_plan_id: plan.data.id, recipe_id: recipeId,
        date: weekStart, scale: 1, cooked_at: null,
      }),
    ]);
    for (const write of writes) if (write.error) throw write.error;

    return { recipeId, mealPlanId: plan.data.id as string };
  }

  const CHILDREN = [
    "recipe_ingredients",
    "recipe_steps",
    "ratings",
    "photos",
    "shortlist_entries",
    "plan_entries",
  ] as const;

  const liveChildren = async (recipeId: string) => {
    const counts: Record<string, number> = {};
    for (const table of CHILDREN) {
      const { count } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("recipe_id", recipeId)
        .is("deleted_at", null);
      counts[table] = count ?? 0;
    }
    return counts;
  };

  it("tombstones every child of a deleted recipe", async () => {
    const { recipeId } = await plantRecipe(household, "Goes away");
    expect(Object.values(await liveChildren(recipeId)).every((n) => n === 1)).toBe(true);

    const deletedAt = new Date().toISOString();
    const { error } = await admin
      .from("recipes")
      .update({ deleted_at: deletedAt })
      .eq("id", recipeId);
    expect(error).toBeNull();

    const after = await liveChildren(recipeId);
    expect(after, "every child should have gone with it").toEqual({
      recipe_ingredients: 0,
      recipe_steps: 0,
      ratings: 0,
      photos: 0,
      shortlist_entries: 0,
      plan_entries: 0,
    });
  });

  it("stamps the children with the parent's exact timestamp", async () => {
    // what makes an undelete possible later: a child that went *because* the parent went is
    // identifiable, and one deleted on its own three weeks earlier is not
    const { recipeId } = await plantRecipe(household, "Timestamped");
    const deletedAt = new Date().toISOString();
    await admin.from("recipes").update({ deleted_at: deletedAt }).eq("id", recipeId);

    const { data: recipe } = await admin
      .from("recipes").select("deleted_at").eq("id", recipeId).single();
    for (const table of CHILDREN) {
      const { data } = await admin
        .from(table).select("deleted_at").eq("recipe_id", recipeId).limit(1).single();
      expect(data?.deleted_at, table).toBe(recipe?.deleted_at);
    }
  });

  it("leaves rows that were already deleted on their own alone", async () => {
    const { recipeId } = await plantRecipe(household, "Partly gone");
    const earlier = new Date(Date.now() - 3 * 86400000).toISOString();
    await admin.from("ratings").update({ deleted_at: earlier }).eq("recipe_id", recipeId);

    await admin.from("recipes").update({ deleted_at: new Date().toISOString() }).eq("id", recipeId);

    const { data: rating } = await admin
      .from("ratings").select("deleted_at").eq("recipe_id", recipeId).single();
    // compared as instants: Postgres renders +00:00 where the input said Z
    expect(
      Date.parse(rating?.deleted_at as string),
      "an earlier deletion keeps its own timestamp",
    ).toBe(Date.parse(earlier));
  });

  it("touches nothing in another household", async () => {
    const mine = await plantRecipe(household, "Mine");
    const theirs = await plantRecipe(other, "Theirs");

    await admin.from("recipes").update({ deleted_at: new Date().toISOString() }).eq("id", mine.recipeId);

    expect(Object.values(await liveChildren(theirs.recipeId)).every((n) => n === 1)).toBe(true);
  });

  it("does not disturb a second recipe in the same household", async () => {
    const doomed = await plantRecipe(household, "Doomed");
    const survivor = await plantRecipe(household, "Survivor");

    await admin.from("recipes").update({ deleted_at: new Date().toISOString() }).eq("id", doomed.recipeId);

    expect(Object.values(await liveChildren(survivor.recipeId)).every((n) => n === 1)).toBe(true);
  });

  it("tombstones a plan's entries when the week itself goes", async () => {
    const { mealPlanId } = await plantRecipe(household, "Weekly");
    await admin.from("meal_plans").update({ deleted_at: new Date().toISOString() }).eq("id", mealPlanId);

    const { count } = await admin
      .from("plan_entries")
      .select("id", { count: "exact", head: true })
      .eq("meal_plan_id", mealPlanId)
      .is("deleted_at", null);
    expect(count).toBe(0);
  });

  describe("a person leaving", () => {
    it("takes their ratings but not the recipes they wrote", async () => {
      // mirrors the foreign keys: ratings cascade on a hard delete, created_by is SET NULL. A
      // score attributed to nobody is worse than no score; a recipe nobody wrote is still dinner.
      const leaver = await admin
        .from("family_members")
        .insert({
          family_id: household.familyId, account_id: null, display_name: "Leaver", colour: null,
          is_child: true,
        })
        .select("id")
        .single();
      if (leaver.error) throw leaver.error;

      const recipe = await admin
        .from("recipes")
        .insert({
          family_id: household.familyId, title: "Written by the leaver", source_name: null,
          source_url: null, servings: null, time_minutes: null, times_made: 0, status: "active",
          visibility: "private", make_again: null, created_by: leaver.data.id,
        })
        .select("id")
        .single();
      if (recipe.error) throw recipe.error;

      const rating = await admin.from("ratings").insert({
        family_id: household.familyId, recipe_id: recipe.data.id,
        family_member_id: leaver.data.id, score: 4, rated_at: new Date().toISOString(),
      });
      if (rating.error) throw rating.error;

      await admin
        .from("family_members")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", leaver.data.id);

      const { count: liveRatings } = await admin
        .from("ratings")
        .select("id", { count: "exact", head: true })
        .eq("family_member_id", leaver.data.id)
        .is("deleted_at", null);
      expect(liveRatings, "their ratings go with them").toBe(0);

      const { data: survived } = await admin
        .from("recipes").select("deleted_at, created_by").eq("id", recipe.data.id).single();
      expect(survived?.deleted_at, "the recipe stays").toBeNull();
      expect(survived?.created_by, "but forgets who wrote it").toBeNull();
    });
  });

  describe("the reverse", () => {
    it("brings back exactly what went with the parent", async () => {
      // nothing in the product restores a row today; this defines the state if anything ever does
      const { recipeId } = await plantRecipe(household, "Comes back");
      const earlier = new Date(Date.now() - 3 * 86400000).toISOString();
      await admin.from("ratings").update({ deleted_at: earlier }).eq("recipe_id", recipeId);

      await admin.from("recipes").update({ deleted_at: new Date().toISOString() }).eq("id", recipeId);
      await admin.from("recipes").update({ deleted_at: null }).eq("id", recipeId);

      const after = await liveChildren(recipeId);
      expect(after.recipe_ingredients).toBe(1);
      expect(after.plan_entries).toBe(1);
      expect(after.photos).toBe(1);
      expect(after.shortlist_entries).toBe(1);
      expect(after.recipe_steps).toBe(1);
      // deleted on its own beforehand, so it stays deleted
      expect(after.ratings, "an independent deletion is not undone").toBe(0);
    });
  });

});

describe.skipIf(instance !== null)("soft delete propagation (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
