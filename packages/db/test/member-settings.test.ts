import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * How each person reads the recipe book — a per-member setting since §87.
 *
 * It was `families.recipe_layout`, and the bug that moved it is the point of the first test here:
 * one member answering the question decided it for everybody, and the member who answered was not
 * the member who cooks.
 *
 * ---------------------------------------------------------------------------
 * The five layouts, on both sides of a boundary SQL cannot cross
 * ---------------------------------------------------------------------------
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

describe.skipIf(instance === null)("how each person reads the recipe book", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  /** a second member of the *same* household — the whole reason this table exists */
  let otherMemberId: string;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "layout", entitled: true,
    });
    const second = await admin
      .from("family_members")
      .insert({
        family_id: household.familyId,
        display_name: "The other one",
        is_child: false,
        colour: null,
      })
      .select("id")
      .single();
    if (second.error) throw second.error;
    otherMemberId = second.data.id as string;
  }, 60_000);

  afterAll(async () => {
    if (instance && household) await deleteTestHousehold(admin, household);
  });

  /*
   * The regression the move exists for. Written first because it is the only assertion here that
   * the old shape could not pass at all: one column cannot hold two answers.
   */
  // regression: a household column meant one member's answer decided the layout for everybody
  it("lets two people in one household read it two different ways", async () => {
    const mine = await admin.from("member_settings").upsert(
      { family_id: household.familyId, family_member_id: household.memberId, recipe_layout: "browse" },
      { onConflict: "family_member_id,family_id" },
    );
    expect(mine.error?.message ?? null).toBeNull();

    const theirs = await admin.from("member_settings").upsert(
      { family_id: household.familyId, family_member_id: otherMemberId, recipe_layout: "rotation" },
      { onConflict: "family_member_id,family_id" },
    );
    expect(theirs.error?.message ?? null).toBeNull();

    const { data } = await admin
      .from("member_settings")
      .select("family_member_id, recipe_layout")
      .eq("family_id", household.familyId)
      .is("deleted_at", null);

    const byMember = new Map((data ?? []).map((row) => [row.family_member_id, row.recipe_layout]));
    expect(byMember.get(household.memberId)).toBe("browse");
    expect(byMember.get(otherMemberId)).toBe("rotation");
  });

  it("holds one row per person, so answering twice is an update and not a second answer", async () => {
    const { error } = await admin.from("member_settings").insert({
      family_id: household.familyId,
      family_member_id: household.memberId,
      recipe_layout: "time",
    });
    // the unique constraint, which is what makes "their layout" a single-valued question
    expect(error, "a second row for one member was accepted").not.toBeNull();
  });

  it("accepts every layout the app can render", async () => {
    for (const layout of RECIPE_LAYOUTS) {
      const { error } = await admin
        .from("member_settings")
        .update({ recipe_layout: layout })
        .eq("family_id", household.familyId)
        .eq("family_member_id", household.memberId);
      expect(error?.message ?? null, `${layout} was refused`).toBeNull();
    }
  });

  it("refuses a layout no screen renders", async () => {
    // 'shelves' and 'index' were ideated and dropped; a stale value must not store, or a screen
    // with no branch for it renders nothing and looks like a styling bug
    for (const bad of ["shelves", "index", "", "Rotation"]) {
      const { error } = await admin
        .from("member_settings")
        .update({ recipe_layout: bad })
        .eq("family_id", household.familyId)
        .eq("family_member_id", household.memberId);
      expect(error, `"${bad}" was accepted`).not.toBeNull();
    }
  });

  /*
   * No row at all for somebody who has never answered — which is what makes "never asked" a
   * per-person state rather than a household one. The app reads the absence as the default and
   * puts the question; it must not invent a row to learn it, because a read that writes is a
   * write on a GET.
   */
  it("gives a new member no row, so they have not been asked", async () => {
    const fresh = await admin
      .from("family_members")
      .insert({ family_id: household.familyId, display_name: "Newly arrived", is_child: true, colour: null })
      .select("id")
      .single();
    if (fresh.error) throw fresh.error;

    const { data, error } = await admin
      .from("member_settings")
      .select("recipe_layout")
      .eq("family_id", household.familyId)
      .eq("family_member_id", fresh.data.id)
      .maybeSingle();
    expect(error?.message ?? null).toBeNull();
    expect(data).toBeNull();
  });

  it("defaults to rotation and never asked when a row is created without either", async () => {
    const fresh = await admin
      .from("family_members")
      .insert({ family_id: household.familyId, display_name: "Defaulting", is_child: true, colour: null })
      .select("id")
      .single();
    if (fresh.error) throw fresh.error;

    const created = await admin
      .from("member_settings")
      .insert({ family_id: household.familyId, family_member_id: fresh.data.id })
      .select("recipe_layout, recipe_layout_asked_at")
      .single();
    expect(created.error?.message ?? null).toBeNull();
    expect(created.data?.recipe_layout).toBe("rotation");
    /*
     * And never asked. A default timestamp here would make every row read as already prompted, so
     * the in-context question could never appear for anybody — which is the whole reason these are
     * two columns rather than one.
     */
    expect(created.data?.recipe_layout_asked_at).toBeNull();
  });

  it("stamps the question without choosing, so a dismissal is not a choice", async () => {
    await admin
      .from("member_settings")
      .update({ recipe_layout: "browse", recipe_layout_asked_at: null })
      .eq("family_id", household.familyId)
      .eq("family_member_id", household.memberId);
    await admin
      .from("member_settings")
      .update({ recipe_layout_asked_at: new Date().toISOString() })
      .eq("family_id", household.familyId)
      .eq("family_member_id", household.memberId);
    const { data } = await admin
      .from("member_settings")
      .select("recipe_layout, recipe_layout_asked_at")
      .eq("family_id", household.familyId)
      .eq("family_member_id", household.memberId)
      .single();
    // the layout survives the stamp: the two columns are independent by design
    expect(data?.recipe_layout).toBe("browse");
    expect(data?.recipe_layout_asked_at).not.toBeNull();
  });

  /*
   * The columns are gone from `families`, attempted rather than read out of a catalogue.
   *
   * The invariant chain forbids their return at migration time, and this is the companion
   * assertion a test can actually make: **attempt the thing it forbids**, because
   * `check:parity` compares answers rather than versions and an environment running an older
   * function body passes its own checks happily. The control matters as much as the refusal —
   * without it, a typo'd table name would refuse for the wrong reason and read as a pass.
   */
  it("no longer carries the layout on the household", async () => {
    const control = await admin.from("families").select("id").eq("id", household.familyId).single();
    expect(control.error?.message ?? null, "the control read failed, so the refusal proves nothing")
      .toBeNull();

    for (const column of ["recipe_layout", "recipe_layout_asked_at"]) {
      const { error } = await admin
        .from("families")
        .select(column)
        .eq("id", household.familyId);
      expect(error, `families.${column} is still selectable`).not.toBeNull();
    }
  });
});
