import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_COLUMNS,
  CLASSIFY_JSON_SCHEMA,
  classificationPrompt,
  classifyRecipe,
} from "../src/classify.js";
import type { LlmProvider, ModelConfig } from "../src/provider.js";

const MODEL: ModelConfig = { provider: "anthropic", model: "m", region: "us" };
const RECIPE = {
  title: "Grandma Overtons Rolls",
  ingredients: ["2 c. milk", "2 packages dry yeast"],
  steps: ["Scald the milk.", "Knead and let rise."],
};

const answering = (json: unknown) => {
  const seen: { content?: string; schema?: unknown } = {};
  const provider: LlmProvider = {
    key: "fake",
    async extract(request) {
      seen.content = request.content;
      seen.schema = request.responseSchema;
      return { json, usage: { model: MODEL.model } };
    },
  };
  return { provider, seen };
};

describe("classifying a recipe that is already saved", () => {
  /*
   * The load-bearing test. A backfill that "corrected" a stored ingredient because the model
   * disagreed would be far worse than empty chips — it would silently rewrite what a person
   * checked on the review screen.
   */
  it("can only ever write the four classification columns", () => {
    expect([...CLASSIFICATION_COLUMNS]).toEqual(["course", "cuisine", "dish_form", "principal_protein"]);
    for (const forbidden of ["title", "servings", "steps", "ingredients", "time_minutes", "photo"]) {
      expect(CLASSIFICATION_COLUMNS).not.toContain(forbidden);
    }
  });

  it("asks for nothing the recipe already stores, so a wrong write is unrepresentable", () => {
    // the schema is the safety property: there is no title field to write back, and no
    // ingredient the model could disagree with
    expect(Object.keys(CLASSIFY_JSON_SCHEMA.properties).sort()).toEqual([
      "course", "cuisine", "dishForm", "principalProtein",
    ]);
    expect(CLASSIFY_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("returns only the four fields, whatever else the model sends", async () => {
    const { provider } = answering({
      course: "main", cuisine: "Italian", dishForm: "soup", principalProtein: "pork",
      title: "SOMETHING ELSE", steps: ["overwrite me"],
    });
    const result = await classifyRecipe({ provider, model: MODEL, recipe: RECIPE });
    expect(Object.keys(result!).sort()).toEqual(["course", "cuisine", "dishForm", "principalProtein"]);
  });

  it("drops a label the column's CHECK would refuse rather than failing the recipe", async () => {
    const { provider } = answering({
      course: "brunch", cuisine: "x".repeat(60), dishForm: "casserole", principalProtein: "tofu",
    });
    const result = await classifyRecipe({ provider, model: MODEL, recipe: RECIPE });
    expect(result).toEqual({ course: null, cuisine: null, dishForm: null, principalProtein: null });
  });

  it("sends one recipe per prompt, so one household's recipes never share a prompt", () => {
    const prompt = classificationPrompt(RECIPE);
    expect(prompt).toContain("Grandma Overtons Rolls");
    expect(prompt).toContain("2 c. milk");
    expect(prompt).toContain("Scald the milk.");
  });

  it("returns null when the model answers nothing, so the recipe is left alone", async () => {
    const { provider } = answering(null);
    expect(await classifyRecipe({ provider, model: MODEL, recipe: RECIPE })).toBeNull();
  });
});
