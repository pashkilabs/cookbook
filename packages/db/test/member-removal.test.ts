import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * What removing a member does to everything that referenced them.
 *
 * The propagation was written in 091900 before anything could create a second member, so it has
 * never run against a household that had one. The rules it encodes:
 *
 *   ratings            CASCADE  — a score attributed to nobody is worse than no score
 *   recipes.created_by SET NULL — a recipe nobody wrote is still dinner
 *
 * Both still look right, and this is where that stops being an opinion. The case that matters for
 * the product is the last one: a recipe detail screen showing a removed member's rating must not
 * break, and it must not show a score with no name against it.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("removing a household member", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "member-removal",
    });
  });

  afterAll(async () => {
    if (!instance || !household) return;
    await deleteTestHousehold(admin, household);
  });

  /** A child, a recipe they are recorded as adding, and their opinion of it. */
  async function plant(name: string) {
    const child = await admin
      .from("family_members")
      .insert({
        family_id: household.familyId,
        account_id: null,
        display_name: name,
        colour: "teal",
        is_child: true,
      })
      .select("id")
      .single();
    if (child.error) throw child.error;

    const recipe = await admin
      .from("recipes")
      .insert({
        family_id: household.familyId,
        title: `${name}'s pie`,
        created_by: child.data.id,
      })
      .select("id")
      .single();
    if (recipe.error) throw recipe.error;

    const rating = await admin.from("ratings").insert({
      family_id: household.familyId,
      recipe_id: recipe.data.id,
      family_member_id: child.data.id,
      score: 5,
      rated_at: new Date().toISOString(),
    });
    if (rating.error) throw rating.error;

    return { memberId: child.data.id as string, recipeId: recipe.data.id as string };
  }

  const remove = (memberId: string) =>
    admin
      .from("family_members")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", memberId);

  it("takes their ratings with them", async () => {
    const { memberId } = await plant("Goes");
    await remove(memberId);

    const { count } = await admin
      .from("ratings")
      .select("id", { count: "exact", head: true })
      .eq("family_member_id", memberId)
      .is("deleted_at", null);
    expect(count, "a score attributed to nobody is worse than no score").toBe(0);
  });

  it("keeps the recipes they added, and forgets who added them", async () => {
    const { memberId, recipeId } = await plant("Wrote");
    await remove(memberId);

    const { data } = await admin
      .from("recipes")
      .select("deleted_at, created_by")
      .eq("id", recipeId)
      .single();
    expect(data?.deleted_at, "a recipe nobody wrote is still dinner").toBeNull();
    expect(data?.created_by).toBeNull();
  });

  it("leaves a detail screen with no score rather than a score with no name", async () => {
    /*
     * The failure this guards: the screen reads members from the seam and ratings from the table,
     * and joins them in memory. If a rating outlived its member, the join would produce a score
     * belonging to nobody — or, depending which side drove the loop, a crash.
     *
     * Both sides filter `deleted_at`, so both drop together. Asserted here as the pair, because
     * either one changing alone is what would break it.
     */
    const { memberId, recipeId } = await plant("Rated");

    const before = await admin
      .from("ratings")
      .select("family_member_id, score")
      .eq("recipe_id", recipeId)
      .is("deleted_at", null);
    expect(before.data, "the fixture really did rate it").toHaveLength(1);

    await remove(memberId);

    const [members, ratings] = await Promise.all([
      admin
        .from("family_members")
        .select("id")
        .eq("family_id", household.familyId)
        .is("deleted_at", null),
      admin
        .from("ratings")
        .select("family_member_id, score")
        .eq("recipe_id", recipeId)
        .is("deleted_at", null),
    ]);

    const live = new Set((members.data ?? []).map((row) => row.id));
    const orphaned = (ratings.data ?? []).filter((row) => !live.has(row.family_member_id));
    expect(orphaned, "no score survives its member").toEqual([]);
  });

  it("does not disturb anybody else in the household", async () => {
    const staying = await plant("Stays");
    const going = await plant("Going");
    await remove(going.memberId);

    const { count } = await admin
      .from("ratings")
      .select("id", { count: "exact", head: true })
      .eq("family_member_id", staying.memberId)
      .is("deleted_at", null);
    expect(count).toBe(1);
  });

  it("still refuses to give a child a login", async () => {
    // the constraint the whole adult/child split rests on (decisions §5), asserted against the
    // table rather than the seam that is supposed to respect it
    const { error } = await admin.from("family_members").insert({
      family_id: household.familyId,
      account_id: household.accountId,
      display_name: "Impossible",
      colour: "clay",
      is_child: true,
    });
    expect(error?.message ?? "").toMatch(/child_has_no_login/);
  });

  it("provisioning does not add a second adult when one already exists", async () => {
    // provisionHousehold is idempotent by account, and this screen adds members beside it —
    // the two must not fight over the row provisioning wrote
    const { data } = await admin
      .from("family_members")
      .select("id")
      .eq("family_id", household.familyId)
      .eq("account_id", household.accountId)
      .is("deleted_at", null);
    expect(data, "exactly one member is linked to the signed-in account").toHaveLength(1);
  });
});

describe.skipIf(instance !== null)("removing a household member (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
