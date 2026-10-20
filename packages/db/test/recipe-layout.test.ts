import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * The five layouts, on both sides of a boundary SQL cannot cross.
 *
 * `private.known_recipe_layouts()` validates storage; `RECIPE_LAYOUTS` in
 * `apps/web/lib/recipe-layout.ts` is what the app renders. SQL cannot import TypeScript, so a value
 * added on one side and not the other would silently refuse a legitimate setting — or admit one no
 * screen can render, which is the dead `lunch` chip reached from the database end.
 *
 * Restated here as a literal rather than imported, because `packages/db` must not depend on
 * `apps/web` — the same trade `household-allergens.test.ts` makes, and it works by **attempting**
 * each value rather than by reading the function's list, so the CHECK is what is exercised.
 */
const RECIPE_LAYOUTS = ["rotation", "browse", "time", "protein", "decide"] as const;

const instance = readLocalInstance();

describe.skipIf(instance === null)("how this household decides what to cook", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "layout", entitled: true,
    });
  }, 60_000);

  afterAll(async () => {
    if (instance && household) await deleteTestHousehold(admin, household);
  });

  it("accepts every layout the app can render", async () => {
    for (const layout of RECIPE_LAYOUTS) {
      const { error } = await admin
        .from("families")
        .update({ recipe_layout: layout })
        .eq("id", household.familyId);
      expect(error?.message ?? null, `${layout} was refused`).toBeNull();
    }
  });

  it("refuses a layout no screen renders", async () => {
    // 'shelves' and 'index' were ideated and dropped; a stale value must not store, or a screen
    // with no branch for it renders nothing and looks like a styling bug
    for (const bad of ["shelves", "index", "", "Rotation"]) {
      const { error } = await admin
        .from("families")
        .update({ recipe_layout: bad })
        .eq("id", household.familyId);
      expect(error, `"${bad}" was accepted`).not.toBeNull();
    }
  });

  it("starts at rotation and never asked", async () => {
    const fresh = await createTestHousehold({
      admin, url: instance!.url, anonKey: instance!.anonKey, label: "layout-default", entitled: true,
    });
    try {
      const { data } = await admin
        .from("families")
        .select("recipe_layout, recipe_layout_asked_at")
        .eq("id", fresh.familyId)
        .single();
      expect(data?.recipe_layout).toBe("rotation");
      /*
       * And never asked. A default timestamp here would make every existing household read as
       * already prompted, so the in-context question could never appear for anybody — which is
       * the whole reason these are two columns rather than one.
       */
      expect(data?.recipe_layout_asked_at).toBeNull();
    } finally {
      await deleteTestHousehold(admin, fresh);
    }
  }, 60_000);

  it("stamps the question without choosing, so a dismissal is not a choice", async () => {
    await admin.from("families").update({ recipe_layout: "browse" }).eq("id", household.familyId);
    await admin
      .from("families")
      .update({ recipe_layout_asked_at: new Date().toISOString() })
      .eq("id", household.familyId);
    const { data } = await admin
      .from("families")
      .select("recipe_layout, recipe_layout_asked_at")
      .eq("id", household.familyId)
      .single();
    // the layout survives the stamp: the two columns are independent by design
    expect(data?.recipe_layout).toBe("browse");
    expect(data?.recipe_layout_asked_at).not.toBeNull();
  });
});
