import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_COLUMNS,
  CLASSIFY_JSON_SCHEMA,
  classificationLines,
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
    const read = await classifyRecipe({ provider, model: MODEL, recipe: RECIPE });
    expect(Object.keys(read!.classification).sort()).toEqual(["course", "cuisine", "dishForm", "principalProtein"]);
  });

  it("drops a label the column's CHECK would refuse rather than failing the recipe", async () => {
    const { provider } = answering({
      course: "brunch", cuisine: "x".repeat(60), dishForm: "casserole", principalProtein: "tofu",
    });
    const read = await classifyRecipe({ provider, model: MODEL, recipe: RECIPE });
    expect(read!.classification).toEqual({ course: null, cuisine: null, dishForm: null, principalProtein: null });
  });

  it("names turkey, which it could not before, and a model answering it is believed", async () => {
    // regression: `turkey` was in none of the nine places these values were spelled, so "Ground
    // Turkey Rice Bowls" came back `pork` three readings out of three — a closed list makes a
    // model reach for the nearest value rather than decline
    const { provider } = answering({ course: "main", cuisine: null, dishForm: "bowl", principalProtein: "turkey" });
    const read = await classifyRecipe({ provider, model: MODEL, recipe: RECIPE });
    expect(read!.classification.principalProtein).toBe("turkey");
    expect(CLASSIFY_JSON_SCHEMA.properties.principalProtein.enum).toContain("turkey");
    expect(CLASSIFY_JSON_SCHEMA.properties.principalProtein.enum).toContain("duck");
  });

  it("reads the recipe three times and stores how much they agreed", async () => {
    // two readings say pork and one says seafood: the answer is pork, and the row says 0.67 so a
    // person can see it was not unanimous. Agreement is recorded and never gated on (§61).
    const answers = ["pork", "seafood", "pork"];
    let call = 0;
    const provider: LlmProvider = {
      key: "fake",
      async extract() {
        const principalProtein = answers[call] ?? null;
        call += 1;
        return { json: { course: "main", cuisine: null, dishForm: null, principalProtein }, usage: { model: MODEL.model } };
      },
    };
    const read = await classifyRecipe({ provider, model: MODEL, recipe: RECIPE });
    expect(call).toBe(3);
    expect(read!.classification.principalProtein).toBe("pork");
    expect(read!.agreement.principalProtein).toBe(0.67);
    expect(read!.agreement.course).toBe(1);
    expect(read!.readings).toBe(3);
  });

  it("declines rather than picking one when three readings disagree three ways", async () => {
    const answers = ["pork", "beef", "chicken"];
    let call = 0;
    const provider: LlmProvider = {
      key: "fake",
      async extract() {
        const principalProtein = answers[call];
        call += 1;
        return { json: { course: "main", cuisine: null, dishForm: null, principalProtein }, usage: { model: MODEL.model } };
      },
    };
    const read = await classifyRecipe({ provider, model: MODEL, recipe: RECIPE });
    expect(read!.classification.principalProtein).toBeNull();
    expect(read!.agreement.principalProtein).toBe(0);
  });

  it("reports no agreement at all when only one reading came back", async () => {
    let call = 0;
    const provider: LlmProvider = {
      key: "fake",
      async extract() {
        call += 1;
        if (call > 1) throw new Error("provider is down");
        return { json: { course: "main", cuisine: null, dishForm: null, principalProtein: "beef" }, usage: { model: MODEL.model } };
      },
    };
    const read = await classifyRecipe({ provider, model: MODEL, recipe: RECIPE });
    // the answer is kept — a lone reading is better than no classification — but a row built
    // during an outage must not read as confidently as one three readings agreed on
    expect(read!.classification.principalProtein).toBe("beef");
    expect(read!.readings).toBe(1);
    expect(read!.agreement.principalProtein).toBe(0);
  });

  it("sends one recipe per prompt, so one household's recipes never share a prompt", () => {
    const prompt = classificationPrompt(RECIPE);
    expect(prompt).toContain("Grandma Overtons Rolls");
    expect(prompt).toContain("2 c. milk");
    expect(prompt).toContain("Scald the milk.");
  });

  it("returns null when every reading answers nothing, so the recipe is left alone", async () => {
    const { provider } = answering(null);
    expect(await classifyRecipe({ provider, model: MODEL, recipe: RECIPE })).toBeNull();
  });
});

describe("the ingredient lines the model is shown", () => {
  /*
   * There are three callers — the backfill, the save path and the measurement harness — and each
   * one wrote this expression out by hand before it was shared. The quantity is the part a
   * careless rewrite drops, and dropping it is not cosmetic: a harness fed `item_text` alone
   * where production feeds amount and unit read every line as `need 0 g` and answered three
   * consolidation questions confidently and wrongly.
   */
  it("keeps the quantity, because a pound of butter and a spoonful are different dishes", () => {
    expect(classificationLines([
      { amount: 1, unit: "lb", item_text: "butter" },
      { amount: 2, unit: "tbsp", item_text: "butter" },
    ])).toEqual(["1 lb butter", "2 tbsp butter"]);
  });

  it("writes a line for an ingredient with no amount and no unit", () => {
    expect(classificationLines([{ item_text: "black pepper" }])).toEqual(["black pepper"]);
    expect(classificationLines([{ amount: null, unit: null, item_text: "salt" }])).toEqual(["salt"]);
  });

  it("carries the note, which is where a form of an ingredient is often written", () => {
    expect(classificationLines([
      { amount: 200, unit: "g", item_text: "pecorino", note: "finely grated" },
    ])).toEqual(["200 g pecorino , finely grated"]);
  });

  it("drops an empty note rather than leaving a trailing comma", () => {
    expect(classificationLines([{ amount: 3, unit: null, item_text: "eggs", note: "" }])).toEqual(["3  eggs"]);
  });

  /*
   * The double space in "3  eggs" is pinned deliberately, and it is not a typo.
   *
   * An ingredient with no unit joins an empty string between amount and item, and `.trim()` only
   * takes the ends — so this is the exact text every stored classification in the library was
   * produced from. Tidying it would be a change to what the model reads.
   *
   * And that change would be **invisible to the provenance stamp**, which is the part worth
   * knowing. `classificationProvenance` hashes the instructions, the schema and the model; the
   * builder that assembles the content is an input to the prompt that it does not cover. So
   * normalising this whitespace would alter every answer while every row kept a stamp saying it
   * was current, and nothing would re-ask — the same shape as `promptKey` fingerprinting every
   * input the recipe carries except the prompt. Pinned here so a tidy-up has to delete a test
   * with this comment in it rather than drift silently.
   */
  it("pins the exact text, because the provenance stamp does not cover this builder", () => {
    expect(classificationLines([
      { amount: 1, unit: "lb", item_text: "butter" },
      { amount: null, unit: null, item_text: "black pepper" },
      { amount: 2, unit: null, item_text: "eggs" },
      { amount: 200, unit: "g", item_text: "pecorino", note: "grated" },
    ])).toEqual(["1 lb butter", "black pepper", "2  eggs", "200 g pecorino , grated"]);
  });
});
