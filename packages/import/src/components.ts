import type { LlmProvider, ModelConfig } from "./provider.js";

/**
 * Break a recipe into the things that were cooked separately (§60, step 2).
 *
 * A component is a group of ingredients prepared together and combinable independently — the
 * sauce, the protein, the grain. It is what blending is built on: taking the sauce from one
 * recipe and the protein from another is only meaningful if "the sauce" is a thing the data
 * knows about.
 *
 * **Positions, not names.** The model returns inclusive ranges over the ingredient list it was
 * given, so a component is a partition of the actual rows rather than a re-listing of them. That
 * makes it checkable — every ingredient belongs to exactly one component or the answer is
 * malformed — and it removes any chance of the model quietly rewriting an ingredient on the way
 * through, which is the failure `classifyRecipe` was shaped to make unrepresentable.
 *
 * **A one-pan dinner is one component, and saying so is the hard part.** Inventing structure in a
 * recipe that has none is the failure that matters: a blend built on a component that was never a
 * component. Eleven of the thirty labelled recipes are single-component for exactly this reason.
 */
export const COMPONENTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["components"],
  properties: {
    components: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "from", "to", "role"],
        properties: {
          name: { type: "string", description: "what a cook would call it — 'the sauce', 'guacamole'" },
          from: { type: "integer", description: "first ingredient position, inclusive" },
          to: { type: "integer", description: "last ingredient position, inclusive" },
          role: {
            type: ["string", "null"],
            enum: ["protein", "carbohydrate", "sauce", "vegetable", "garnish", null],
          },
        },
      },
    },
  },
} as const;

export const COMPONENTS_INSTRUCTIONS = [
  "You are shown a recipe's title and its ingredients, numbered from 0. Split them into the",
  "things that are cooked or assembled separately — the sauce, the protein, the grain, the salad.",
  "",
  "Every ingredient belongs to exactly one component. Give inclusive position ranges that cover",
  "the whole list with no gaps and no overlaps, in the order they appear.",
  "",
  "**Most recipes are one component.** A one-pan skillet, a soup, a traybake, a marinade — these",
  "are single things however many ingredients they list. Return one component covering everything",
  "unless the recipe genuinely makes separate items that could be served apart. Inventing a split",
  "that is not there is worse than missing one: somebody may build a meal on it.",
  "",
  "Three things give a real split away. Ingredients are listed in the order they are used, so a",
  "component is contiguous. A staple repeating — salt, oil, pepper appearing twice — usually means",
  "two things were seasoned separately. And a change of purpose: a list that goes from a protein",
  "and its spices to an oil, an acid and a herb has moved from the meat to the dressing.",
  "",
  "Say each component's role, or null if none of them fits. A dessert is often none of them.",
].join(" ");

export interface RecipeComponent {
  name: string;
  from: number;
  to: number;
  role: string | null;
}

const ROLES = new Set(["protein", "carbohydrate", "sauce", "vegetable", "garnish"]);

export function componentsPrompt(recipe: {
  title: string;
  ingredients: readonly string[];
}): string {
  return [
    recipe.title,
    "",
    "Ingredients:",
    ...recipe.ingredients.map((line, index) => `${index}. ${line}`),
  ].join("\n");
}

/**
 * Returns null when the model answers nothing usable — a decline, scored apart from a wrong
 * answer, because the two are different news and want opposite corrections.
 *
 * A proposal that does not partition the list is refused rather than repaired. Overlapping or
 * gapped ranges mean the model was not doing the task, and quietly patching them would turn a
 * visible failure into a plausible one.
 */
export async function inferComponents(options: {
  provider: LlmProvider;
  model: ModelConfig;
  recipe: { title: string; ingredients: readonly string[] };
  /** the headings the recipe declared, when it declared any — a strong prior, never the answer */
  sections?: readonly (string | null)[] | null;
  /**
   * Why a null was returned, when one is.
   *
   * "The model answered nothing" and "the model answered something that is not a partition" are
   * different failures and want opposite corrections — the first needs less caution, the second
   * needs a clearer instruction about covering the list. Collapsing them into one null is the
   * same mistake as scoring a decline and a wrong answer together (§54a), one level down.
   */
  onReject?: (reason: "empty" | "malformed") => void;
}): Promise<RecipeComponent[] | null> {
  const { recipe, sections } = options;
  const declared =
    sections && sections.some((s) => s)
      ? [
          "",
          "The recipe declared these headings, one per ingredient above. Trust them where they are",
          "real component names, and ignore ones that are not — 'You'll need:' is not a component.",
          ...sections.map((s, i) => `${i}. ${s ?? "-"}`),
        ].join("\n")
      : "";

  const response = await options.provider.extract({
    model: options.model,
    instructions: COMPONENTS_INSTRUCTIONS,
    content: componentsPrompt(recipe) + declared,
    responseSchema: COMPONENTS_JSON_SCHEMA,
  });

  const json = response.json as { components?: unknown } | null;
  if (!Array.isArray(json?.components) || json.components.length === 0) {
    options.onReject?.("empty");
    return null;
  }

  const parsed: RecipeComponent[] = [];
  for (const raw of json.components) {
    if (typeof raw !== "object" || raw === null) {
      options.onReject?.("malformed");
      return null;
    }
    const c = raw as Record<string, unknown>;
    if (typeof c.from !== "number" || typeof c.to !== "number") {
      options.onReject?.("malformed");
      return null;
    }
    if (!Number.isInteger(c.from) || !Number.isInteger(c.to) || c.from > c.to) {
      options.onReject?.("malformed");
      return null;
    }
    parsed.push({
      name: typeof c.name === "string" ? c.name.trim() : "",
      from: c.from,
      to: c.to,
      role: typeof c.role === "string" && ROLES.has(c.role) ? c.role : null,
    });
  }

  if (coversExactly(parsed, recipe.ingredients.length)) return parsed;
  options.onReject?.("malformed");
  return null;
}

/**
 * Every position covered exactly once — a partition, not a selection.
 *
 * Refused rather than repaired: a proposal with a gap or an overlap is a model that was not doing
 * this task, and a repaired one would look like a reading.
 */
export function coversExactly(components: readonly RecipeComponent[], count: number): boolean {
  const seen = new Set<number>();
  for (const c of components) {
    if (c.from < 0 || c.to >= count) return false;
    for (let i = c.from; i <= c.to; i += 1) {
      if (seen.has(i)) return false;
      seen.add(i);
    }
  }
  return seen.size === count;
}
