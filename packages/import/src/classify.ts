import type { LlmProvider, ModelConfig } from "./provider.js";

/**
 * Classify a recipe that is already stored, without re-extracting it.
 *
 * ---------------------------------------------------------------------------
 * Why this is separate from the extractor
 * ---------------------------------------------------------------------------
 *
 * The extraction schema returns a whole recipe — title, ingredient lines, steps. Reusing it for a
 * backfill would mean holding a model's fresh opinion about every field beside the stored one,
 * and one careless write would overwrite a person's review-screen corrections with a guess.
 *
 * **So the model is never asked about anything already stored.** This schema has four fields and
 * no others; there is no title to write back, no ingredient it could disagree with. The narrow
 * schema is the safety property, not the test — a test can only check the code, and this makes
 * the wrong write unrepresentable.
 *
 * ---------------------------------------------------------------------------
 * A thinner input than a caption, and it will show
 * ---------------------------------------------------------------------------
 *
 * The 18/18 measurement was on captions, where prose carries the answer: "MARRY ME ITALIAN
 * SAUSAGE SOUP for Valentine's Day" gives course and cuisine free. A stored recipe has lost that
 * — the title survives, the ingredients and steps survive, and everything around them is gone.
 *
 * Cuisine is the field that suffers, because it lived in the prose. Expect more declines, and
 * treat that as correct rather than as a weakness: a null shows as absent, and a wrong answer
 * shows as a chip that lies.
 */
export const CLASSIFY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["course", "cuisine", "dishForm", "principalProtein"],
  properties: {
    course: {
      type: ["string", "null"],
      enum: ["breakfast", "starter", "main", "side", "dessert", "drink", "snack", null],
    },
    cuisine: { type: ["string", "null"] },
    dishForm: {
      type: ["string", "null"],
      enum: ["soup", "salad", "sandwich", "bake", "stew", "bowl", null],
    },
    principalProtein: {
      type: ["string", "null"],
      enum: ["chicken", "beef", "pork", "lamb", "fish", "seafood", "egg", "vegetarian", "vegan", null],
    },
  },
} as const;

export const CLASSIFY_INSTRUCTIONS = [
  "You are shown a recipe that has already been read and saved. Classify it. Change nothing.",
  "Say which course the dish is. Course is almost always answerable from the dish itself:",
  "anything substantial enough to be the centre of a meal is a main, including soups, stews,",
  "pasta, curries, wraps and bowls. A sweet baked thing is a dessert or a breakfast, never a",
  "snack. Use snack only for something small and savoury eaten between meals, and starter or",
  "side only when it is plainly one. Answer null only if you genuinely cannot tell.",
  "Cuisine is the opposite: null unless the title names it or the dish is unmistakably of one",
  "tradition. Do not guess from a single ingredient — olive oil does not make a recipe Italian —",
  "and never answer with a region: Thai, not Asian.",
  "Say the dish's form only if it is plainly one of the listed shapes — a soup is a soup even",
  "when it is the main course. Most dishes are none of them; answer null rather than reaching.",
  "Say the principal protein the dish is built around: the one a person would name if asked what",
  "they were eating. Sausage, bacon and ham are pork. Answer vegetarian or vegan only when beans,",
  "lentils, tofu or another plant protein is what the dish is built on. A dessert, a bread or a",
  "salad of vegetables has none — answer null. Absence of meat is not vegetarian.",
].join(" ");

export interface RecipeClassification {
  course: string | null;
  cuisine: string | null;
  dishForm: string | null;
  principalProtein: string | null;
}

/** the closed lists the columns' CHECK constraints enforce, so a bad label never reaches one */
const COURSES = new Set(["breakfast", "starter", "main", "side", "dessert", "drink", "snack"]);
const DISH_FORMS = new Set(["soup", "salad", "sandwich", "bake", "stew", "bowl"]);
const PROTEINS = new Set([
  "chicken", "beef", "pork", "lamb", "fish", "seafood", "egg", "vegetarian", "vegan",
]);

const pick = (allowed: Set<string>, value: unknown): string | null =>
  typeof value === "string" && allowed.has(value) ? value : null;

/**
 * The stored recipe as the model sees it.
 *
 * **One recipe per prompt, and only this recipe.** Batching several would be cheaper and would
 * put one household's recipes in a prompt beside another's; it would also let the model's reading
 * of one dish colour another. Neither is worth the saving on a corpus this size.
 */
export function classificationPrompt(recipe: {
  title: string;
  ingredients: readonly string[];
  steps: readonly string[];
}): string {
  return [
    recipe.title,
    "",
    "Ingredients:",
    ...recipe.ingredients,
    "",
    "Method:",
    ...recipe.steps,
  ].join("\n");
}

export async function classifyRecipe(options: {
  provider: LlmProvider;
  model: ModelConfig;
  recipe: { title: string; ingredients: readonly string[]; steps: readonly string[] };
}): Promise<RecipeClassification | null> {
  const response = await options.provider.extract({
    model: options.model,
    instructions: CLASSIFY_INSTRUCTIONS,
    content: classificationPrompt(options.recipe),
    responseSchema: CLASSIFY_JSON_SCHEMA,
  });

  const json = response.json as Record<string, unknown> | null;
  if (!json) return null;

  const cuisine = typeof json.cuisine === "string" ? json.cuisine.trim() : "";
  return {
    course: pick(COURSES, json.course),
    // 40 is the column's limit; a model writing a sentence has not answered the question
    cuisine: cuisine.length > 0 && cuisine.length <= 40 ? cuisine : null,
    dishForm: pick(DISH_FORMS, json.dishForm),
    principalProtein: pick(PROTEINS, json.principalProtein),
  };
}

/**
 * The only columns a backfill may write.
 *
 * Exported so a test can assert it rather than trusting a reviewer to notice: a backfill that
 * "corrected" a stored ingredient because the model disagreed would be far worse than empty
 * chips, and this list is the thing that must never quietly grow.
 */
export const CLASSIFICATION_COLUMNS = ["course", "cuisine", "dish_form", "principal_protein"] as const;
