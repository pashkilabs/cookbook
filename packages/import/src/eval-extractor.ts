import type {
  Extractor,
  ExtractedRecipe as EvalRecipe,
  ExtractorOutput,
  FixtureInput,
  RefusalReason,
} from "@pashki/core/eval";
import type { ImportOptions, Tier } from "./types.js";
import { importRecipe } from "./pipeline.js";
import { extractWithLlm } from "./tier2.js";
import { importFromImages } from "./vision.js";
import { createPassthroughImagePreparer, type ImagePreparer, type SourceImage } from "./prepare-image.js";

/**
 * The import pipeline as an eval `Extractor`, so the harness can measure it the
 * moment real fixtures land.
 *
 * This is the point of having built the harness first: choosing a model, deciding
 * whether the model should return parsed amounts or verbatim lines, and knowing the
 * tier-0 hit rate are all measurements, and this is the wire that makes them
 * measurable rather than arguable.
 */

export interface ImportExtractorOptions extends ImportOptions {
  /** report the cost the cascade actually incurred, so the harness can sum it */
  reportUsage?: boolean;
  /**
   * How to turn a fixture's `imagePath` into bytes.
   *
   * A port rather than `node:fs` directly, so the harness can be driven from a test
   * with in-memory images and so nothing here has to know where fixtures live.
   */
  loadImage?: (path: string) => Promise<Uint8Array>;
  /** defaults to the passthrough preparer; production passes the sharp one */
  preparer?: ImagePreparer;
}

/**
 * Maps a fixture input onto the right entry point:
 *
 * - `url` runs the whole cascade, so the harness sees tier 0 and 1 hit rates.
 * - `caption` goes straight to tier 2. Pasted text has no markup to read, so the
 *   deterministic tiers have nothing to do — this is the path tier 2 exists for.
 * - `screenshot` runs tier 3 over every frame the fixture lists, fused into one
 *   recipe. Null only when tier 3 cannot be attempted — no vision model configured,
 *   or no image loader — so the harness records a skip rather than scoring a zero
 *   against something that was never wired up.
 */
export function createImportExtractor(options: ImportExtractorOptions): Extractor {
  return async (input: FixtureInput): Promise<ExtractorOutput | null> => {
    if (input.kind === "screenshot") {
      // tier 3. Null when it cannot be attempted at all, so the harness records a
      // skip rather than scoring a zero against something that was never configured.
      if (!options.llm?.visionModels || !options.loadImage) return null;

      const paths = [input.imagePath, ...(input.extraImagePaths ?? [])];
      const images: SourceImage[] = [];
      for (const path of paths) {
        try {
          images.push({ bytes: await options.loadImage(path), label: path });
        } catch {
          // a missing fixture image is a broken fixture, not a bad extractor
          return null;
        }
      }

      const outcome = await importFromImages(images, {
        cascade: options.llm,
        preparer: options.preparer ?? createPassthroughImagePreparer(),
      });
      if (!outcome.ok) {
        const refusal = refusalFor(outcome.failure);
        // null still means "not my kind of input"; a refusal means "I read it and there is no
        // recipe here". Conflating them left confabulation unmeasured on the path most likely
        // to do it — a reel that shows a dish and withholds the recipe.
        return refusal ? { refused: { because: refusal } } : null;
      }

      const evaluated = toEvalRecipe(outcome.recipe, "vision");
      const usage = outcome.usage.at(-1);
      if (options.reportUsage && usage) evaluated.usage = toUsage(usage);
      return evaluated;
    }

    if (input.kind === "url") {
      /*
       * A fixture's captured snapshot is the input, not the live page. Re-fetching
       * would make yesterday's score unrepeatable and would measure whatever the
       * site published this morning. The fetcher is swapped for one that serves the
       * capture, so tiers 0 and 1 read exactly what was hand-checked.
       */
      const snapshot = input.text;
      const withSnapshot: ImportExtractorOptions = snapshot
        ? {
            ...options,
            fetcher: {
              async page() {
                return { finalUrl: input.url, contentType: "text/html", html: snapshot };
              },
              async bytes() {
                throw new Error("a fixture carries no images");
              },
            },
          }
        : options;
      const outcome = await importRecipe(input.url, withSnapshot);
      if (!outcome.ok) {
        const refusal = refusalFor(outcome.failure);
        return refusal ? { refused: { because: refusal } } : null;
      }
      return toEvalRecipe(outcome.recipe, outcome.tier);
    }

    // caption
    if (!options.llm) return null;
    const llm = await extractWithLlm({
      content: input.text,
      sourceUrl: "",
      sourceName: null,
      cascade: options.llm,
    });
    if (!llm.recipe) return null;

    const usage = llm.usage.at(-1);
    const evaluated = toEvalRecipe(llm.recipe, "llm");
    if (options.reportUsage && usage) evaluated.usage = toUsage(usage);
    return evaluated;
  };
}

function toUsage(usage: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}): NonNullable<EvalRecipe["usage"]> {
  return {
    model: usage.model,
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
  };
}

/**
 * The harness scores amount, unit and item, and `ParsedIngredient` is structurally
 * assignable to what it wants, so nothing is remapped — which is deliberate. A
 * translation layer here would be a second place for a field to drift.
 *
 * `steps` and the image are not scored: the fixture format records the fields a
 * review screen has to get right, and a step-by-step diff would need a fixture format
 * that hand-checks prose.
 */
function toEvalRecipe(
  recipe: { title: string | null; servings: number | null; totalMinutes: number | null; ingredients: EvalRecipe["ingredients"] },
  tier: Tier,
): EvalRecipe {
  return {
    tier,
    title: recipe.title,
    servings: recipe.servings,
    totalMinutes: recipe.totalMinutes,
    ingredients: recipe.ingredients,
  };
}

/**
 * Which failures are a refusal, and which are "I could not look".
 *
 * The distinction is the whole point (decisions §46). A page that fetched and carried no recipe
 * is an answer — *this is not a recipe page* — and the product can say so. A page that would not
 * fetch is not an answer about the page at all, and reporting it as a refusal would score the
 * network as if it were a judgement.
 */
function refusalFor(failure: { kind: string } | undefined): RefusalReason | null {
  switch (failure?.kind) {
    case "no-recipe-found":
    case "recipe-incomplete":
      // read, and there was nothing in it
      return "not-a-recipe-page";
    case "blocked-platform":
      // Instagram, TikTok, Facebook — these never resolve server-side (CLAUDE.md)
      return "unresolvable-source";
    case "no-usable-images":
    case "vision-not-configured":
    case "fetch-failed":
    case "not-html":
    case "invalid-url":
    case "private-address":
      // nothing was read, so nothing can be concluded about what was there
      return null;
    default:
      return null;
  }
}
