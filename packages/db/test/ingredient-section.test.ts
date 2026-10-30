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

  /*
   * **This bound moved from 80 to 200, so this assertion inverted.** It required 81 characters to
   * be refused, which was right against the old CHECK and would now defend a limit that a real
   * heading nearly hit: The BEST Meatball Recipe writes
   * "For Sauce (Or you may substitute 3-4 cups of your favorite, quality marinara sauce)" — 83
   * characters, one past the old cap and the reason for `20261029090000_section_length`.
   *
   * It points at a judgement about how long a heading can be, not at a rule, so if that judgement
   * changes again this flips again. What does not change is that there *is* a bound: a section
   * arriving at a thousand characters is markup the reader misread.
   */
  it("accepts a heading that is prose, since real ones run to eighty-odd characters", async () => {
    const { error } = await household.client.from("recipe_ingredients").insert({
      family_id: household.familyId, recipe_id: recipeId, position: 3,
      item_text: "sugar", amount: 1, unit: "cup", note: "", is_estimated: false,
      section: "For Sauce (Or you may substitute 3-4 cups of your favorite, quality marinara sauce)",
    });
    expect(error).toBeNull();
  });

  it("refuses a section longer than a heading could be", async () => {
    const { error } = await household.client.from("recipe_ingredients").insert({
      family_id: household.familyId, recipe_id: recipeId, position: 4,
      item_text: "flour", amount: 1, unit: "cup", note: "", is_estimated: false,
      section: "x".repeat(201),
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
