import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * A recipe imported with headings keeps them.
 *
 * `ParsedIngredient.section` has existed since the parser did and nothing ever stored it: it was
 * computed on every import and discarded at save, so a card reading "Frosting:" arrived with its
 * structure and was written without it. Invisible, because nothing downstream asked.
 *
 * It matters now because a declared section is the strongest evidence a recipe gives about its own
 * components (§60), and a re-parse cannot recover a heading that was never written down — every
 * import before this landed lost it permanently.
 */
const instance = readLocalInstance();
const NO_PRIVILEGE = "42501";

describe.skipIf(instance === null)("the heading a recipe wrote", () => {
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
      label: "section",
    });

    const recipe = await household.client
      .from("recipes")
      .insert({
        family_id: household.familyId,
        title: "Cinnamon rolls",
        status: "active",
        visibility: "private",
        times_made: 0,
      })
      .select("id")
      .single();
    if (recipe.error) throw recipe.error;
    recipeId = recipe.data.id;
  });

  afterAll(async () => {
    if (!instance) return;
    await deleteTestHousehold(admin, household);
  });

  it("is stored, so a Frosting: heading survives the save", async () => {
    const { error } = await household.client.from("recipe_ingredients").insert([
      { family_id: household.familyId, recipe_id: recipeId, position: 0,
        item_text: "flour", amount: 3, unit: "cup", note: "", is_estimated: false, section: "Dough" },
      { family_id: household.familyId, recipe_id: recipeId, position: 1,
        item_text: "cream cheese", amount: 1, unit: null, note: "", is_estimated: false, section: "Frosting" },
    ]);
    expect(error).toBeNull();

    const back = await household.client
      .from("recipe_ingredients")
      .select("item_text, section")
      .eq("recipe_id", recipeId)
      .order("position");
    expect(back.data).toEqual([
      { item_text: "flour", section: "Dough" },
      { item_text: "cream cheese", section: "Frosting" },
    ]);
  });

  it("stays null for a recipe that declared none, which is most captions", async () => {
    const { error } = await household.client.from("recipe_ingredients").insert({
      family_id: household.familyId, recipe_id: recipeId, position: 2,
      item_text: "salt", amount: 1, unit: "tsp", note: "", is_estimated: false, section: null,
    });
    expect(error).toBeNull();
    const back = await household.client
      .from("recipe_ingredients").select("section").eq("recipe_id", recipeId).eq("position", 2).single();
    expect(back.data?.section).toBeNull();
  });

  // a heading is a label, not a paragraph; the column refuses one long enough to be a mistake
  it("refuses a section longer than a heading could be", async () => {
    const { error } = await household.client.from("recipe_ingredients").insert({
      family_id: household.familyId, recipe_id: recipeId, position: 3,
      item_text: "sugar", amount: 1, unit: "cup", note: "", is_estimated: false,
      section: "x".repeat(81),
    });
    expect(error).not.toBeNull();
  });

  it("is not writable by anon, which writes no recipe at all", async () => {
    const anon = createClient(instance!.url, instance!.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await anon.from("recipe_ingredients").insert({
      family_id: household.familyId, recipe_id: recipeId, position: 4,
      item_text: "butter", amount: 1, unit: "cup", note: "", is_estimated: false, section: "Dough",
    });
    expect(error).not.toBeNull();
  });
});
