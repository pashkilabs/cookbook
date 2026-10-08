import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * A base in the freezer: a pantry item that remembers which part of which recipe it is.
 *
 * **The decrement is what replaces an expiry date**, so it is tested directly rather than
 * assumed. No date column: guessing shelf life per food either discards good food or leaves a
 * dead item deducting from the shopping list, and the list is the one output that costs money
 * when it is wrong. Reaching zero is deletion happening naturally, so only an *abandoned* base
 * lingers — and that is the path a date would otherwise have hidden.
 */
const instance = readLocalInstance();
const CHECK_VIOLATION = "23514";

describe.skipIf(instance === null)("a base kept in the freezer", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  let recipeId: string;

  const base = (extra: Record<string, unknown> = {}) => ({
    family_id: household.familyId,
    name: "greek dressing",
    amount: 2,
    unit: null,
    ingredient_id: null,
    from_recipe_id: recipeId,
    from_component: "dressing",
    ...extra,
  });

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "base", entitled: true,
    });
    const made = await household.client
      .from("recipes")
      .insert({ family_id: household.familyId, title: "Greek Salad", status: "active", visibility: "private" })
      .select("id")
      .single();
    if (made.error) throw made.error;
    recipeId = made.data.id;
  });

  afterAll(async () => {
    if (!instance) return;
    await deleteTestHousehold(admin, household);
  });

  it("is a pantry item that knows which part of which recipe it is", async () => {
    const { data, error } = await household.client
      .from("pantry_items").insert(base()).select("from_recipe_id, from_component, amount").single();
    expect(error).toBeNull();
    expect(data?.from_component).toBe("dressing");
    expect(Number(data?.amount)).toBe(2);
    await household.client.from("pantry_items").delete().eq("from_recipe_id", recipeId);
  });

  it("decrements: two batches, cook one, one remains", async () => {
    // the path an expiry date would have hidden
    const made = await household.client.from("pantry_items").insert(base()).select("id").single();
    expect(made.error).toBeNull();

    const used = await household.client
      .from("pantry_items").update({ amount: 1 }).eq("id", made.data!.id).select("amount").single();
    expect(Number(used.data?.amount)).toBe(1);

    const gone = await household.client
      .from("pantry_items").update({ amount: 0 }).eq("id", made.data!.id).select("amount").single();
    expect(Number(gone.data?.amount)).toBe(0);
    await household.client.from("pantry_items").delete().eq("id", made.data!.id);
  });

  it("refuses a base with no amount, which could never be decremented", async () => {
    // without this it would deduct from the shopping list for ever, and there is no date to stop it
    const { error } = await household.client.from("pantry_items").insert(base({ amount: null }));
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("refuses a negative batch count", async () => {
    const { error } = await household.client.from("pantry_items").insert(base({ amount: -1 }));
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("refuses a base that names a recipe without naming its part", async () => {
    // its lines could not be looked up, which is the only thing the recipe id is for
    const { error } = await household.client.from("pantry_items").insert(base({ from_component: null }));
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("allows an ordinary pantry item, which is neither", async () => {
    const { error } = await household.client.from("pantry_items").insert({
      family_id: household.familyId, name: "carrots", amount: null, unit: null,
      ingredient_id: null, from_recipe_id: null, from_component: null,
    });
    expect(error).toBeNull();
  });

  it("survives its recipe being tidied away, keeping the name of the part", async () => {
    /*
     * Nullify, not tombstone: the base is still in the freezer. ON DELETE CASCADE does not
     * fire on a soft delete, so this is the trigger doing it — and the CHECK had to be
     * loosened to one direction, because `nullify` cannot clear a second column.
     */
    const made = await household.client.from("pantry_items").insert(base()).select("id").single();
    expect(made.error).toBeNull();

    await household.client
      .from("recipes").update({ deleted_at: new Date().toISOString() }).eq("id", recipeId);

    const after = await household.client
      .from("pantry_items").select("from_recipe_id, from_component, name, deleted_at")
      .eq("id", made.data!.id).single();
    expect(after.data?.from_recipe_id).toBeNull();
    expect(after.data?.from_component).toBe("dressing");
    expect(after.data?.deleted_at).toBeNull();
    expect(after.data?.name).toBe("greek dressing");
  });

  it("cannot name another household's recipe", async () => {
    // the composite key: assert_household_invariants refused a plain FK for exactly this
    const other = await createTestHousehold({
      admin, url: instance!.url, anonKey: instance!.anonKey, label: "base-other",
    });
    const theirs = await admin
      .from("recipes")
      .insert({ family_id: other.familyId, title: "Theirs", status: "active", visibility: "private" })
      .select("id").single();

    const { error } = await household.client
      .from("pantry_items").insert(base({ from_recipe_id: theirs.data!.id }));
    expect(error).not.toBeNull();
    await deleteTestHousehold(admin, other);
  });
});

/**
 * The journey the no-expiry decision rests on, walked in order.
 *
 * Keep two batches → the shopping list stops buying that part → cook once → one batch left →
 * the list still stops buying it → cook again → zero → the list buys it again. That last step
 * is the one an expiry date would have hidden: without the decrement a base deducts for ever,
 * and the list is the one output that costs money when it is wrong.
 *
 * The deduction itself is `linesCoveredByBase` over the stored partition, tested in core. This
 * walks what the database and the arithmetic do together.
 */
describe.skipIf(instance === null)("a base, from kept to used up", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  let recipeId: string;
  let baseId: string;

  const LINES = [
    "olive oil", "red wine vinegar", "oregano", "honey", "dijon",      // 0-4 dressing
    "cucumber", "tomatoes", "kalamata olives", "feta",                 // 5-8 salad
  ];

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "usedup", entitled: true,
    });
    const made = await household.client
      .from("recipes")
      .insert({ family_id: household.familyId, title: "Greek Salad", status: "active", visibility: "private" })
      .select("id").single();
    if (made.error) throw made.error;
    recipeId = made.data.id;

    const { error } = await household.client.from("recipe_ingredients").insert(
      LINES.map((item, position) => ({
        family_id: household.familyId, recipe_id: recipeId, position,
        amount: 1, unit: null, item_text: item, note: "", is_estimated: false,
        section: null, ingredient_id: null,
      })),
    );
    if (error) throw error;

    // the partition the base's lines are looked up in. Written as the service role because
    // `components` is derived and the client holds no grant on it.
    const split = await admin.from("recipes").update({
      components: [
        { name: "dressing", from: 0, to: 4, role: "sauce" },
        { name: "salad", from: 5, to: 8, role: "vegetable" },
      ],
      components_key: "test", components_agreement: 1, components_readings: 3,
    }).eq("id", recipeId);
    if (split.error) throw split.error;
  });

  afterAll(async () => {
    if (!instance) return;
    await deleteTestHousehold(admin, household);
  });

  const batches = async () => {
    const { data } = await household.client
      .from("pantry_items").select("amount").eq("id", baseId).single();
    return Number(data?.amount);
  };

  it("keeps two batches of the dressing", async () => {
    const made = await household.client.from("pantry_items").insert({
      family_id: household.familyId, name: "greek dressing", amount: 2, unit: null,
      ingredient_id: null, from_recipe_id: recipeId, from_component: "dressing",
    }).select("id").single();
    expect(made.error).toBeNull();
    baseId = made.data!.id;
    expect(await batches()).toBe(2);
  });

  it("spends one when the meal is cooked, leaving one", async () => {
    await household.client.from("pantry_items").update({ amount: 1 }).eq("id", baseId);
    expect(await batches()).toBe(1);
  });

  it("spends the last one and sits at zero rather than vanishing", async () => {
    /*
     * Zero, not a tombstone. A row at zero is a base the household used up, and the shopping
     * list already ignores it — deleting it would lose that it was ever there, and the whole
     * point of no expiry date is that running out is what ends a base.
     */
    await household.client.from("pantry_items").update({ amount: 0 }).eq("id", baseId);
    expect(await batches()).toBe(0);
    const { data } = await household.client
      .from("pantry_items").select("deleted_at").eq("id", baseId).single();
    expect(data?.deleted_at).toBeNull();
  });

  it("will not go below zero, so an extra cook cannot invent a debt", async () => {
    const { error } = await household.client
      .from("pantry_items").update({ amount: -1 }).eq("id", baseId);
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(await batches()).toBe(0);
  });
});
