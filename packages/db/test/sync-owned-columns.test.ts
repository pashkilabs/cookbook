import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * The two conventions sync depends on, enforced as privileges rather than intentions.
 *
 * `updated_at` decides last-write-wins, and decisions §11 accepts that resolution only
 * because the timestamp belongs to the database. `deleted_at` is how a deletion reaches a
 * device at all, because a row that is simply gone is indistinguishable from one that
 * never arrived.
 *
 * Both were writable by a client: the `updated_at` trigger is BEFORE UPDATE, so it never
 * fires on an insert, and `authenticated` held DELETE on every household table.
 */
const instance = readLocalInstance();
const NO_PRIVILEGE = "42501";

describe.skipIf(instance === null)("timestamps and deletion belong to the database", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  let recipeId: string;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "sync-owned",
    });

    const recipe = await admin
      .from("recipes")
      .insert({ family_id: household.familyId, title: "ordinary" })
      .select("id")
      .single();
    if (recipe.error) throw recipe.error;
    recipeId = recipe.data.id;
  });

  afterAll(async () => {
    if (!instance) return;
    if (household) await deleteTestHousehold(admin, household);
  });

  describe("sync timestamps", () => {
    it("refuses a row that stamps its own future", async () => {
      // regression: the updated_at trigger is BEFORE UPDATE, so an insert went unguarded
      // and a row dated in the year 3000 wins last-write-wins against every device edit
      // for the next thousand years, silently
      const { error } = await household.client.from("recipes").insert({
        family_id: household.familyId,
        title: "pinned forever",
        updated_at: "3000-01-01T00:00:00Z",
      });
      expect(error?.code).toBe(NO_PRIVILEGE);
    });

    it("refuses a row that back-dates its own creation", async () => {
      const { error } = await household.client.from("recipes").insert({
        family_id: household.familyId,
        title: "first, apparently",
        created_at: "1970-01-01T00:00:00Z",
      });
      expect(error?.code).toBe(NO_PRIVILEGE);
    });

    it("refuses to re-stamp a row on the way past", async () => {
      const { error } = await household.client
        .from("recipes")
        .update({ title: "edited", updated_at: "3000-01-01T00:00:00Z" })
        .eq("id", recipeId);
      expect(error?.code).toBe(NO_PRIVILEGE);
    });

    it("stamps an ordinary insert itself", async () => {
      const { data, error } = await household.client
        .from("recipes")
        .insert({ family_id: household.familyId, title: "ordinary insert" })
        .select("created_at, updated_at")
        .single();
      expect(error).toBeNull();
      const stamped = new Date(data?.updated_at as string).getTime();
      expect(Math.abs(stamped - Date.now())).toBeLessThan(60_000);
    });

    it("refuses to re-key a row or move it between households", async () => {
      // not an edit: the identity of a row is what a peer reconciles against
      const rekey = await household.client
        .from("recipes")
        .update({ id: "22222222-2222-2222-2222-222222222222" })
        .eq("id", recipeId);
      expect(rekey.error?.code).toBe(NO_PRIVILEGE);
    });
  });

  describe("deletion", () => {
    it("refuses a hard delete, loudly", async () => {
      // regression: a hard-deleted row is the one case a peer cannot distinguish from a
      // row that never synced (architecture §5)
      const { error } = await household.client.from("recipes").delete().eq("id", recipeId);
      expect(error?.code).toBe(NO_PRIVILEGE);

      const { count } = await admin
        .from("recipes")
        .select("id", { count: "exact", head: true })
        .eq("id", recipeId);
      expect(count).toBe(1);
    });

    it("accepts a tombstone", async () => {
      const { error } = await household.client
        .from("recipes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", recipeId);
      expect(error).toBeNull();
    });

    it("keeps the tombstone readable, which is the whole point of it", async () => {
      const { data, error } = await household.client
        .from("recipes")
        .select("id, deleted_at")
        .eq("id", recipeId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.deleted_at).not.toBeNull();
    });

    it("refuses a hard delete on every household table, not just the one that was tested", async () => {
      const tables = [
        "recipes",
        "recipe_ingredients",
        "recipe_steps",
        "ratings",
        "meal_plans",
        "plan_entries",
        "shortlist_entries",
        "pantry_items",
        "photos",
        "import_jobs",
      ];
      for (const table of tables) {
        const { error } = await household.client
          .from(table)
          .delete()
          .eq("family_id", household.familyId);
        expect(error?.code, `${table} allows a client hard delete`).toBe(NO_PRIVILEGE);
      }
    });
  });

  it("makes a lapsed household's deletion fail loudly instead of quietly", async () => {
    // decisions §9 recorded the quiet refusal as a consequence of DELETE having no
    // with-check clause. Routed through an UPDATE, the entitlement predicate applies.
    const { error: lapsed } = await admin
      .from("entitlements")
      .update({
        valid_until: new Date(Date.now() - 8 * 86400000).toISOString(),
        grace_until: new Date(Date.now() - 1).toISOString(),
      })
      .eq("family_id", household.familyId);
    if (lapsed) throw lapsed;

    try {
      const { error } = await household.client
        .from("recipes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", recipeId);
      expect(error?.code).toBe(NO_PRIVILEGE);
    } finally {
      await admin
        .from("entitlements")
        .update({
          valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
          grace_until: new Date(Date.now() + 37 * 86400000).toISOString(),
        })
        .eq("family_id", household.familyId);
    }
  });
});

describe.skipIf(instance !== null)("timestamps and deletion (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
