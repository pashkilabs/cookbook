import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeBlend, consolidate, createCatalog, parseIngredientList, partIsIntact,
} from "@pashki/core";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * The journeys a blend has to survive, walked in order across every boundary they cross.
 *
 * CLAUDE.md's rule: *a value crossing three or more boundaries gets one test that walks the
 * whole path.* Component tests cover the hops and cannot see the join by construction, and four
 * bugs have now lived in a join and none in a hop. A blend crosses more boundaries than anything
 * else here — compose, insert, read back, plan, consolidate — and **a blend that plans but does
 * not shop is exactly the failure no component test would show.**
 *
 * So these do not assert that `composeBlend` composes or that `consolidate` consolidates. Both
 * are tested where they live. These assert that what one writes is what the next one reads.
 */
const instance = readLocalInstance();

/** the catalog the shopping list consolidates against, minimal and explicit */
const catalog = createCatalog([
  { key: "cream", names: ["cream", "double cream", "heavy cream"], aisle: "dairy",
    dimension: "volume", packages: [{ label: "pint", amount: 473 }] },
  { key: "flour", names: ["flour", "plain flour"], aisle: "baking",
    dimension: "weight", packages: [{ label: "bag", amount: 1000 }] },
]);

describe.skipIf(instance === null)("a blend, from composition to the shopping list", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;
  let blendId: string;
  let otherRecipeId: string;
  let composed: ReturnType<typeof composeBlend>;

  const insertRecipe = async (fields: Record<string, unknown>) => {
    const made = await household.client
      .from("recipes")
      .insert({ family_id: household.familyId, status: "active", visibility: "private", ...fields })
      .select("id")
      .single();
    if (made.error) throw made.error;
    return made.data.id as string;
  };

  const insertLines = async (
    recipeId: string,
    lines: Array<{ amount: number | null; unit: string | null; itemText: string; section: string | null }>,
  ) => {
    // every column on every row: a PostgREST batch sends the union of keys and passes NULL for
    // whatever a row omits, so a column default never applies
    const { error } = await household.client.from("recipe_ingredients").insert(
      lines.map((line, position) => ({
        family_id: household.familyId, recipe_id: recipeId, position,
        amount: line.amount, unit: line.unit, item_text: line.itemText,
        note: "", is_estimated: false, section: line.section, ingredient_id: null,
      })),
    );
    if (error) throw error;
  };

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "handoff", entitled: true,
    });

    // two sources, each serving a different number — which is why a blend states no servings
    const sauceRecipe = await insertRecipe({ title: "Creamy sauce", servings: 4 });
    await insertLines(sauceRecipe, [
      { amount: 200, unit: "ml", itemText: "cream", section: null },
      { amount: 50, unit: "g", itemText: "flour", section: null },
    ]);
    const fishRecipe = await insertRecipe({ title: "Roast cod", servings: 2 });
    await insertLines(fishRecipe, [{ amount: 2, unit: null, itemText: "cod fillets", section: null }]);

    composed = composeBlend([
      { sourceRecipeId: sauceRecipe, sourceTitle: "Creamy sauce", componentName: "the sauce",
        role: "sauce", taken: "component", adjusted: true, agreement: 0.8, readings: 3,
        ingredients: [
          { amount: 200, unit: "ml", itemText: "cream", note: "", isEstimated: false, section: null },
          { amount: 50, unit: "g", itemText: "flour", note: "", isEstimated: false, section: null },
        ],
        steps: ["Reduce the cream."] },
      { sourceRecipeId: fishRecipe, sourceTitle: "Roast cod", componentName: "the cod",
        role: "protein", taken: "component", adjusted: false, agreement: 0.9, readings: 3,
        ingredients: [
          { amount: 2, unit: null, itemText: "cod fillets", note: "", isEstimated: false, section: null },
        ],
        steps: ["Roast the cod."] },
    ]);

    blendId = await insertRecipe({
      title: "The sauce with the cod",
      servings: composed.servings,
      derived_at: new Date().toISOString(),
    });
    await insertLines(
      blendId,
      composed.ingredients.map((line) => ({
        amount: line.amount, unit: line.unit, itemText: line.itemText, section: line.section,
      })),
    );
    const lineage = await household.client.from("recipe_derivations").insert(
      composed.parts.map((part, position) => ({
        family_id: household.familyId, blend_recipe_id: blendId,
        source_recipe_id: part.sourceRecipeId, position, taken: part.taken,
        component_name: part.componentName, role: part.role, source_title: part.sourceTitle,
        ingredients_from: part.ingredientsFrom, ingredients_to: part.ingredientsTo,
        steps_from: part.stepsFrom, steps_to: part.stepsTo,
        lines_key: part.linesKey, steps_key: part.stepsKey,
        source_agreement: part.agreement, source_readings: part.readings, adjusted: part.adjusted,
      })),
    );
    if (lineage.error) throw lineage.error;

    // a second, unrelated recipe wanting the same thing — the point of consolidation
    otherRecipeId = await insertRecipe({ title: "Friday pudding", servings: 4 });
    // 250 rather than 300 on purpose: with the blend's 200 that is 450 ml, and a US pint is
    // 473, so one covers both. At 300 the honest answer is two pints — which the first run of
    // this test reported, correctly, against an assertion that had done the sum wrong.
    await insertLines(otherRecipeId, [
      { amount: 250, unit: "ml", itemText: "cream", section: null },
    ]);
  });

  afterAll(async () => {
    if (!instance) return;
    await deleteTestHousehold(admin, household);
  });

  it("still knows which lines came from which recipe after a round trip through the database", async () => {
    // compose -> insert -> Postgres -> read back -> recompute the key -> the heading on screen
    const back = await household.client
      .from("recipe_ingredients")
      .select("position, amount, unit, item_text, note, is_estimated, section")
      .eq("recipe_id", blendId)
      .is("deleted_at", null)
      .order("position");
    expect(back.error).toBeNull();

    const asRead = {
      ingredients: (back.data ?? []).map((row) => ({
        amount: row.amount === null ? null : Number(row.amount),
        unit: row.unit, itemText: row.item_text ?? "", note: row.note ?? "",
        isEstimated: Boolean(row.is_estimated), section: row.section,
      })),
      steps: composed.steps.map((step) => step.text),
    };

    const parts = await household.client
      .from("recipe_derivations")
      .select("component_name, source_title, ingredients_from, ingredients_to, steps_from, steps_to, lines_key, steps_key")
      .eq("blend_recipe_id", blendId)
      .is("deleted_at", null)
      .order("position");
    expect(parts.error).toBeNull();
    expect(parts.data).toHaveLength(2);

    for (const part of parts.data ?? []) {
      expect(
        partIsIntact(
          { ingredientsFrom: part.ingredients_from, ingredientsTo: part.ingredients_to,
            stepsFrom: part.steps_from, stepsTo: part.steps_to,
            linesKey: part.lines_key, stepsKey: part.steps_key },
          asRead,
        ),
      ).toBe(true);
    }

    // and the headings the screen draws are the parts' names, through the section column
    expect(asRead.ingredients.map((line) => line.section)).toEqual([
      "the sauce", "the sauce", "the cod",
    ]);
  });

  it("notices when an edit moves the lines out from under a part", async () => {
    // the failure this key exists for: a heading drawn over somebody else's ingredients
    const parts = await household.client
      .from("recipe_derivations")
      .select("ingredients_from, ingredients_to, steps_from, steps_to, lines_key, steps_key")
      .eq("blend_recipe_id", blendId)
      .is("deleted_at", null)
      .order("position");

    const edited = {
      ingredients: [
        { amount: 200, unit: "ml", itemText: "creme fraiche", note: "", isEstimated: false, section: "the sauce" },
        { amount: 50, unit: "g", itemText: "flour", note: "", isEstimated: false, section: "the sauce" },
        { amount: 2, unit: null, itemText: "cod fillets", note: "", isEstimated: false, section: "the cod" },
      ],
      steps: composed.steps.map((step) => step.text),
    };
    const first = parts.data![0]!;
    expect(
      partIsIntact(
        { ingredientsFrom: first.ingredients_from, ingredientsTo: first.ingredients_to,
          stepsFrom: first.steps_from, stepsTo: first.steps_to,
          linesKey: first.lines_key, stepsKey: first.steps_key },
        edited,
      ),
    ).toBe(false);
  });

  it("is planned by multiplier, because it states no servings for anyone to scale", async () => {
    // a blend's parts were written for 4 and for 2, so there is no honest number — `servings`
    // is null and the planner's servings path cannot apply. This is the handoff: the composer
    // decides null, and the planner has to cope with it rather than refuse the recipe.
    const stored = await household.client
      .from("recipes").select("servings, derived_at").eq("id", blendId).single();
    expect(stored.data?.servings).toBeNull();
    expect(stored.data?.derived_at).not.toBeNull();

    const plan = await household.client
      .from("meal_plans")
      .insert({ family_id: household.familyId, week_start: "2026-09-14" })
      .select("id")
      .single();
    expect(plan.error).toBeNull();

    const entry = await household.client.from("plan_entries").insert({
      family_id: household.familyId, meal_plan_id: plan.data!.id, recipe_id: blendId,
      date: "2026-09-15", scale: 1.5, slot: "dinner",
    }).select("id, scale").single();
    expect(entry.error).toBeNull();
    expect(Number(entry.data!.scale)).toBe(1.5);
  });

  it("buys one pint of cream between the blend and another recipe planned the same week", async () => {
    /*
     * The payoff, and the sentence in the release note that bounds the duplication oddity: the
     * blend does not merge its own duplicate lines, but the shopping list combines across every
     * recipe in a week and treats a blend like any other. This walks the read the list actually
     * does — by recipe_id, family-scoped — rather than a stand-in for it.
     */
    const lineRows = await household.client
      .from("recipe_ingredients")
      .select("recipe_id, position, amount, unit, item_text, note")
      .eq("family_id", household.familyId)
      .in("recipe_id", [blendId, otherRecipeId])
      .is("deleted_at", null)
      .order("position");
    expect(lineRows.error).toBeNull();

    const byRecipe = new Map<string, string[]>();
    for (const row of lineRows.data ?? []) {
      const lines = byRecipe.get(row.recipe_id) ?? [];
      lines.push(
        [row.amount === null ? "" : String(row.amount), row.unit ?? "", row.item_text]
          .filter(Boolean).join(" ") + (row.note ? `, ${row.note}` : ""),
      );
      byRecipe.set(row.recipe_id, lines);
    }
    // the blend contributed its lines at all — a silently empty list would consolidate to
    // nothing and every assertion below would pass for the wrong reason
    expect(byRecipe.get(blendId)).toHaveLength(3);

    const shopping = consolidate(
      [
        { label: "The sauce with the cod", groupKey: "2026-09-15",
          ingredients: parseIngredientList(byRecipe.get(blendId)!), scale: 1 },
        { label: "Friday pudding", groupKey: "2026-09-18",
          ingredients: parseIngredientList(byRecipe.get(otherRecipeId)!), scale: 1 },
      ],
      catalog,
    );

    const cream = shopping.find((line) => line.key === "cream");
    expect(cream, "cream should be on the list").toBeTruthy();
    // 200 ml from the blend and 250 from Friday: one 473 ml pint covers both
    expect(cream!.needed).toBe(450);
    expect(cream!.packages?.[0]?.count).toBe(1);
    // and it says both recipes wanted it, which is what makes the number checkable
    expect(cream!.uses).toHaveLength(2);
  });
});
