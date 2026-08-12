import { parseIngredientList, stripTags } from "@pashki/core";
import type { ExtractedRecipe, TierAttempt } from "./types.js";
import {
  EXTRACTION_INSTRUCTIONS,
  RECIPE_JSON_SCHEMA,
  validateRecipePayload,
  type LlmCascade,
  type LlmUsage,
} from "./provider.js";

/**
 * Tier 2: a model over the page's text, when the page published nothing readable.
 *
 * The cheapest thing that could work is tried first and escalation happens **only on
 * schema-validation failure** — not on a low-confidence feeling, and not on a retry
 * loop. That is the whole reason the output is schema-constrained: it gives a
 * machine-checkable signal for when a cheaper model was not good enough, which is
 * what makes running cheap models safe (decisions §7).
 */

/** How much page text to send. */
const MAX_CONTENT_CHARS = 24_000;

/**
 * Reduce a page to the text a model should read.
 *
 * Scripts, styles and navigation are removed before truncating, because the useful
 * part of a recipe page is often halfway down and a naive truncation sends 24k
 * characters of menu. This is deliberately crude — tuning it is a measurement, and
 * the fixtures do not exist.
 */
export function pageToText(html: string): string {
  const withoutNoise = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside|form|svg)[\s\S]*?<\/\1>/gi, " ");

  // Block boundaries have to survive stripTags, which collapses all whitespace
  // including newlines. So split on them first, strip each piece, and rejoin — an
  // ingredient list flattened into one line is materially harder to read back out.
  return withoutNoise
    .split(/<\/(?:li|p|div|h[1-6]|tr)>|<br\s*\/?>/i)
    .map((piece) => stripTags(piece).trim())
    .filter((piece) => piece.length > 0)
    .join("\n")
    .slice(0, MAX_CONTENT_CHARS);
}

export interface Tier2Input {
  /** page text or a pasted caption — recipe content only */
  content: string;
  sourceUrl: string;
  sourceName: string | null;
  cascade: LlmCascade;
}

export interface Tier2Result {
  recipe: ExtractedRecipe | null;
  /** one entry per model tried, so the eval harness can report the escalation */
  attempts: TierAttempt[];
  usage: LlmUsage[];
}

/**
 * Run the cascade. Never throws: a provider failure is an attempt with an outcome.
 */
export async function extractWithLlm(input: Tier2Input): Promise<Tier2Result> {
  const attempts: TierAttempt[] = [];
  const usage: LlmUsage[] = [];

  if (!input.content.trim()) {
    attempts.push({ tier: "llm", outcome: "no-data", detail: "nothing to read" });
    return { recipe: null, attempts, usage };
  }

  for (const model of input.cascade.models) {
    let response;
    try {
      response = await input.cascade.provider.extract({
        model,
        responseSchema: RECIPE_JSON_SCHEMA,
        instructions: EXTRACTION_INSTRUCTIONS,
        content: input.content,
      });
    } catch (thrown) {
      attempts.push({
        tier: "llm",
        outcome: "provider-error",
        model: model.model,
        detail: thrown instanceof Error ? thrown.message : String(thrown),
      });
      // a transport failure is worth escalating past: the next model is usually a
      // different vendor, so it is not the same outage
      continue;
    }

    usage.push(response.usage);

    // the provider was asked to enforce the schema and is not trusted to have done
    // it — this is the check that decides whether to escalate
    const validated = validateRecipePayload(response.json);
    if (!validated.ok) {
      attempts.push({
        tier: "llm",
        outcome: "invalid-output",
        model: model.model,
        detail: validated.errors.join("; "),
      });
      continue;
    }

    attempts.push({ tier: "llm", outcome: "hit", model: model.model });
    return {
      recipe: {
        title: validated.value.title,
        servings: validated.value.servings,
        totalMinutes: validated.value.totalMinutes,
        // the model found the lines; core parses them, the same as every other tier
        ingredients: parseIngredientList(validated.value.ingredientLines),
        steps: validated.value.steps,
        // a model is never asked for an image URL: it would invent a plausible one,
        // and a wrong image is worse than none. Images come from the page's markup.
        imageUrl: null,
        sourceUrl: input.sourceUrl,
        sourceName: input.sourceName,
      },
      attempts,
      usage,
    };
  }

  return { recipe: null, attempts, usage };
}
