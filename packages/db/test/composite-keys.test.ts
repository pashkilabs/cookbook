import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * Composite foreign keys, on every child table rather than one.
 *
 * Every household table carries `family_id`, even where a parent already implies it,
 * so a policy never has to join. What keeps that denormalisation honest is a composite
 * foreign key: a child references `(parent_id, family_id)` together, so a row claiming
 * a household its parent does not belong to fails at write time.
 *
 * This fails **quietly** if it is wrong. There is no error and no denied request — just
 * a row filed under the wrong household. Only `recipe_ingredients` was covered, and the
 * constraints are hand-written per table, which is exactly where a typo lives — writing
 * these found two references that were single-column and should not have been.
 *
 * Completeness is not asserted here, because a test can only check the tables somebody
 * remembered to list. `private.assert_rls_invariants()` fails the migration if any
 * reference between household tables omits `family_id`, which catches the table nobody
 * thought to add to the list below.
 *
 * Run as the service role on purpose. RLS is not what is being tested — the point is
 * that the integrity holds even for a caller that bypasses policies entirely, which is
 * how the import service and every future migration will write.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("composite foreign keys", () => {
  let admin: SupabaseClient;
  let alpha: TestHousehold;
  let beta: TestHousehold;
  let alphaRecipeId: string;
  let alphaMealPlanId: string;
  let alphaMemberId: string;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    alpha = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "fk-alpha",
    });
    beta = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "fk-beta",
    });
    alphaMemberId = alpha.memberId;

    const recipe = await admin
      .from("recipes")
      .insert({ family_id: alpha.familyId, title: "Alpha pie" })
      .select("id")
      .single();
    if (recipe.error) throw recipe.error;
    alphaRecipeId = recipe.data.id;

    const plan = await admin
      .from("meal_plans")
      .insert({ family_id: alpha.familyId, week_start: "2026-08-17" })
      .select("id")
      .single();
    if (plan.error) throw plan.error;
    alphaMealPlanId = plan.data.id;
  });

  afterAll(async () => {
    if (!instance) return;
    for (const household of [beta, alpha].filter(Boolean)) {
      await deleteTestHousehold(admin, household);
    }
  });

  /**
   * Each case names a child row that points at one of alpha's parents while claiming
   * whichever household is passed in — the shape of a cross-household leak.
   *
   * The household is a parameter because `photos` has its own constraint tying
   * `storage_path` to `family_id`; a path built from the wrong household would fail
   * that instead of the foreign key, and the test would pass for the wrong reason.
   */
  const cases = (familyId: string) => [
    {
      table: "recipe_ingredients",
      row: { recipe_id: alphaRecipeId, position: 0, item_text: "1 cup cream" },
    },
    {
      table: "recipe_steps",
      row: { recipe_id: alphaRecipeId, position: 0, text: "Stir." },
    },
    {
      table: "ratings",
      row: { recipe_id: alphaRecipeId, family_member_id: alphaMemberId, score: 5 },
    },
    {
      table: "photos",
      row: { recipe_id: alphaRecipeId, storage_path: `${familyId}/y.jpg`, source: "camera" },
    },
    {
      table: "shortlist_entries",
      row: { recipe_id: alphaRecipeId, week_start: "2026-08-17" },
    },
    {
      table: "plan_entries",
      row: {
        meal_plan_id: alphaMealPlanId,
        recipe_id: alphaRecipeId,
        date: "2026-08-18",
      },
    },
  ];

  it("refuses a child row that claims a household its parent does not belong to", async () => {
    for (const { table, row } of cases(beta.familyId)) {
      const { error } = await admin.from(table).insert({ ...row, family_id: beta.familyId });
      // a foreign key violation, not a policy refusal: the service role bypasses RLS
      expect(error?.code, `${table} accepted a cross-household row`).toBe("23503");
    }
  });

  it("accepts the same row when the household matches", async () => {
    // the converse, so the test above cannot pass because the insert was simply wrong
    for (const { table, row } of cases(alpha.familyId)) {
      const { error } = await admin.from(table).insert({ ...row, family_id: alpha.familyId });
      expect(error, `${table} rejected a valid row`).toBeNull();
    }
  });

  it("refuses a plan entry whose meal plan and recipe belong to different households", async () => {
    // plan_entries carries two composite keys, so it can be wrong two ways
    const betaPlan = await admin
      .from("meal_plans")
      .insert({ family_id: beta.familyId, week_start: "2026-08-24" })
      .select("id")
      .single();
    if (betaPlan.error) throw betaPlan.error;

    const { error } = await admin.from("plan_entries").insert({
      family_id: beta.familyId,
      meal_plan_id: betaPlan.data.id,
      // beta's own plan, but alpha's recipe
      recipe_id: alphaRecipeId,
      date: "2026-08-25",
    });
    expect(error?.code).toBe("23503");
  });

  it("refuses a child row pointing at a parent that does not exist at all", async () => {
    const { error } = await admin.from("recipe_ingredients").insert({
      family_id: alpha.familyId,
      recipe_id: "00000000-0000-0000-0000-000000000000",
      position: 0,
      item_text: "1 cup nothing",
    });
    expect(error?.code).toBe("23503");
  });

  it("refuses a rating attributed to a person in another household", async () => {
    // ratings.family_member_id used to reference family_members by id alone, so a
    // household could score a recipe as somebody it had never met
    const { error } = await admin.from("ratings").insert({
      family_id: alpha.familyId,
      recipe_id: alphaRecipeId,
      family_member_id: beta.memberId,
      score: 1,
    });
    expect(error?.code).toBe("23503");
  });

  it("refuses a recipe crediting an author in another household", async () => {
    const { error } = await admin.from("recipes").insert({
      family_id: alpha.familyId,
      title: "Not theirs to write",
      created_by: beta.memberId,
    });
    expect(error?.code).toBe("23503");
  });

  it("keeps a recipe when its author leaves, rather than refusing the deletion", async () => {
    // the composite key nulls created_by only; nulling family_id too would hit NOT NULL
    // and turn removing a family member into an error
    const author = await admin
      .from("family_members")
      .insert({ family_id: alpha.familyId, display_name: "Leaver", is_child: false })
      .select("id")
      .single();
    if (author.error) throw author.error;

    const recipe = await admin
      .from("recipes")
      .insert({ family_id: alpha.familyId, title: "Outlives its author", created_by: author.data.id })
      .select("id")
      .single();
    if (recipe.error) throw recipe.error;

    const removed = await admin.from("family_members").delete().eq("id", author.data.id);
    expect(removed.error).toBeNull();

    const after = await admin
      .from("recipes")
      .select("created_by, family_id")
      .eq("id", recipe.data.id)
      .single();
    expect(after.data).toEqual({ created_by: null, family_id: alpha.familyId });
  });

  it("accepts an unattributed recipe, because most are imported", async () => {
    // MATCH SIMPLE: a null author skips the composite check rather than failing it
    const { error } = await admin
      .from("recipes")
      .insert({ family_id: alpha.familyId, title: "Nobody typed this", created_by: null });
    expect(error).toBeNull();
  });
});

describe.skipIf(instance !== null)("composite foreign keys (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
