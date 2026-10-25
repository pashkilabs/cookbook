import { PRINCIPAL_PROTEIN_ENUM, READINGS_NEEDED, consensusLabels, isPrincipalProtein } from "@pashki/core";
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
 * The caption measurement was on captions, where prose carries the answer: "MARRY ME ITALIAN
 * SAUSAGE SOUP for Valentine's Day" gives course and cuisine free. A stored recipe has lost that
 * — the title survives, the ingredients and steps survive, and everything around them is gone.
 *
 * **That measurement said 18/18 and it was one hand run. Re-measured over three runs** by
 * `pnpm --filter @pashki/import measure:captions` (decisions §96), it reproduces on no axis:
 *
 *     course            16.0/18   15-17 (±1.0)
 *     cuisine           16.7/18   16-17 (±0.5)
 *     dishForm          12.7/18   12-14 (±1.0)
 *     principalProtein  15.7/18   15-16 (±0.5)
 *
 * So the expectation below — that cuisine suffers most on a stored recipe — is right about the
 * direction and was calibrated against a figure four points too high. `dishForm` is the weak axis
 * on captions too, and for the same reason the protein axis is weak here: **the model reaches
 * rather than declining**, and `bowl` is what it reaches for (9 of 16 wrong answers across all
 * four axes and all three runs).
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
      // from `@pashki/core`, with the column's CHECK compared against the same list by a test:
      // nine places spelled these out, and a value missing from one of them is a wrong answer
      enum: PRINCIPAL_PROTEIN_ENUM,
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
  "they were eating. Sausage, bacon and ham are pork. Dairy is never the principal protein:",
  "butter, cream, cheese and yoghurt do not answer this question, and nor does peanut butter, in",
  "any quantity. Where dairy sits beside a meat or a fish, the answer is that meat or fish; where",
  "dairy is the richest thing in the dish, there is none. Answer vegetarian or vegan only when beans,",
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
// proteins are `isPrincipalProtein` from core — the same list the schema's enum is built from

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

/**
 * The ingredient lines as the model sees them — one builder, because there are three callers.
 *
 * The backfill, the save path and the measurement harness each wrote this expression out. A
 * harness that formats its input differently from production is the divergence that let the eval
 * read a card perfectly while the app sent an Anthropic model id to Together — and this project
 * has already paid for this exact shape once, when a consolidation harness fed `item_text` alone
 * where production feeds amount, unit and item, so every reading was `need 0 g` and three
 * questions got the same confident wrong answer.
 *
 * The amount and unit are not optional decoration. "2 tbsp butter" and "1 lb butter" are
 * different dishes, and the second is the one a model should refuse to call a protein.
 */
export const classificationLines = (
  rows: readonly {
    amount?: number | string | null;
    unit?: string | null;
    item_text?: string | null;
    note?: string | null;
  }[],
): string[] =>
  rows.map((row) =>
    [row.amount ?? "", row.unit ?? "", row.item_text ?? "", row.note ? `, ${row.note}` : ""]
      .join(" ")
      .trim(),
  );

/**
 * The fields a classification carries, in the order a reader meets them.
 *
 * Exported so the consensus, the agreement column and any caller counting them read one list —
 * the same reasoning as the proteins: a field spelled in several places is a field that will be
 * spelled in one of them only.
 */
export const CLASSIFICATION_FIELDS = ["course", "cuisine", "dishForm", "principalProtein"] as const;

export interface ClassificationReading {
  classification: RecipeClassification;
  /** per field, the chosen value's share of the readings that came back, 0..1 */
  agreement: Record<(typeof CLASSIFICATION_FIELDS)[number], number>;
  /** how many of the readings returned a usable answer — one is not a consensus */
  readings: number;
}

/** one look at one recipe: validated here, so a value outside the lists never reaches a vote */
async function oneReading(options: {
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
    principalProtein: isPrincipalProtein(json.principalProtein) ? json.principalProtein : null,
  };
}

/**
 * Classify a recipe by reading it three times and voting, field by field.
 *
 * ---------------------------------------------------------------------------
 * Why three readings live in here and not in the callers
 * ---------------------------------------------------------------------------
 *
 * There are two callers — the backfill script and the save path — and the last time a model
 * change had two sites, the eval was wired up, watched to work, and production went on sending an
 * Anthropic model id to Together. A caller that *can* take one reading eventually does. So the
 * single reading is private and `classifyRecipe` is the only thing exported: taking one is not an
 * option either of them has.
 *
 * ---------------------------------------------------------------------------
 * Why voting at all, when agreement is not correctness
 * ---------------------------------------------------------------------------
 *
 * `COMPONENT_TRUST` records that three readings agreeing perfectly were still wrong four times in
 * eleven, on the reasoning that three runs at temperature zero are one opinion sampled thrice.
 * That is right about what agreement *means* and wrong about the premise: `openai/gpt-oss-120b`
 * is a reasoning model and temperature zero does not make it deterministic. The same recipe and
 * the same prompt returned `[null, chicken, null]` and `[pork, seafood, seafood]` — so the samples
 * differ, and a vote is worth the difference between noise and bias. Measured on the eight
 * misclassified recipes, three of seven moved between readings and four were stably wrong.
 * **Voting fixes the first kind and cannot touch the second**, which is why it landed beside a
 * widened enum rather than instead of one.
 *
 * ---------------------------------------------------------------------------
 * The cost, said out loud
 * ---------------------------------------------------------------------------
 *
 * Three inference calls per recipe where there was one. They run together rather than in
 * sequence, so the wall clock is the slowest call and not their sum — which matters because the
 * save path runs inside a serverless function with a duration cap, and three sixty-second
 * timeouts in series would be killed before the write, paying for work nothing stores.
 */
export async function classifyRecipe(options: {
  provider: LlmProvider;
  model: ModelConfig;
  recipe: { title: string; ingredients: readonly string[]; steps: readonly string[] };
  /** how many readings to take; only a measurement harness has any business changing it */
  readings?: number;
}): Promise<ClassificationReading | null> {
  const wanted = Math.max(1, options.readings ?? READINGS_NEEDED);

  const readings = await Promise.all(
    Array.from({ length: wanted }, async () => {
      try {
        return await oneReading(options);
      } catch {
        // a provider failure is not a reading — dropped rather than counted as disagreement
        return null;
      }
    }),
  );

  const agreed = consensusLabels(readings, CLASSIFICATION_FIELDS);
  if (!agreed) return null;

  /*
   * One surviving reading reports no agreement at all, following `componentsFor`: a row built on
   * a single answer during an outage must not look more confident than one three readings agreed
   * on, because the figure a person reads is the only thing standing between them and a chapter
   * that lies.
   */
  const alone = agreed.readings === 1;
  const agreement = Object.fromEntries(
    CLASSIFICATION_FIELDS.map((field) => [field, alone ? 0 : agreed.agreement[field]]),
  ) as ClassificationReading["agreement"];

  return {
    classification: {
      course: agreed.chosen.course,
      cuisine: agreed.chosen.cuisine,
      dishForm: agreed.chosen.dishForm,
      principalProtein: agreed.chosen.principalProtein,
    },
    agreement,
    readings: agreed.readings,
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
