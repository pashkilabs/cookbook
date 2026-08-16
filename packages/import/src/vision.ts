import { parseIngredientLine } from "@pashki/core";
import type { ExtractedRecipe, ImportFailure, TierAttempt } from "./types.js";
import { missingFields } from "./recipe.js";
import type { JsonSchema, LlmCascade, LlmUsage } from "./provider.js";
import type {
  ImageLimits,
  ImagePreparer,
  PrepareFailure,
  PreparedImage,
  SourceImage,
} from "./prepare-image.js";

/**
 * Tier 3: a recipe read out of screenshots.
 *
 * The hardest input in the product and, per decisions §7, the weakest link in the
 * cascade — stylised text laid over food is materially harder than document OCR, and
 * a phone screenshot of a reel is not a document. Nothing here is tuned and no model
 * is chosen; both are measurements the fixtures do not yet allow.
 *
 * All the supplied images go in **one** call. A reel splits its recipe across the
 * on-screen card, the caption and a pinned comment, so fusing them is the task rather
 * than a post-processing step: three separate extractions produce three partial
 * recipes and leave the merge to code that cannot see the pictures.
 */

/**
 * What tier 3 must return.
 *
 * Two fields exist here that tier 2's schema does not have, and both earn their place:
 *
 * `amountEstimated` per ingredient, because reels say "a splash of cream" and the
 * review screen has to show which numbers were guessed. A first-class boolean rather
 * than a note, so it can be a column (`recipe_ingredients.is_estimated`), a filter,
 * and a visible marker — a note would be prose nobody queries.
 *
 * `dishImageIndex`, because the one thing a model may legitimately choose is which of
 * the images the *user supplied* shows the finished dish. That is selection among
 * given options, not the invention of a URL, which is why tier 2 is forbidden from
 * naming an image and this is not.
 */
export const VISION_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "servings", "totalMinutes", "ingredientLines", "steps", "dishImageIndex"],
  properties: {
    title: {
      type: ["string", "null"],
      description: "The recipe's name. null if nothing on screen names a dish.",
    },
    servings: { type: ["integer", "null"], description: "Servings, or null if not shown." },
    totalMinutes: {
      type: ["integer", "null"],
      description: "Total time in minutes, or null if not shown.",
    },
    ingredientLines: {
      type: "array",
      description:
        "Every ingredient, fused across all the images. One entry each, in the order given.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "section", "amountEstimated"],
        properties: {
          text: {
            type: "string",
            description:
              "The ingredient exactly as shown, including amount and unit if they are shown. If no amount appears, write the ingredient alone. Never invent one, and never convert a parenthetical note into a unit — '2 squares (2 oz.)' is 2 squares.",
          },
          section: {
            type: ["string", "null"],
            description:
              "The heading this ingredient appeared under, verbatim, or null if there are none.",
          },
          amountEstimated: {
            type: "boolean",
            description:
              "true if the amount was spoken aloud or implied rather than shown as text. Never a substitute for inventing one: if no amount exists, write none.",
          },
        },
      },
    },
    steps: { type: "array", items: { type: "string" }, description: "The method, in order." },
    dishImageIndex: {
      type: ["integer", "null"],
      description:
        "Zero-based index of the supplied image that best shows the finished dish, or null if none do.",
    },
  },
};

export const VISION_INSTRUCTIONS = [
  "Read the recipe from the images into the given JSON schema.",
  "The images are parts of one recipe — an on-screen card, a caption, a comment — so combine them into a single recipe rather than describing each.",
  "Copy ingredient text as written.",
  "Where no amount is shown, write the ingredient with no amount. Never invent one.",
  "Set amountEstimated to true only for an amount you heard rather than read.",
  "Give each ingredient the heading it appeared under, verbatim, or null.",
  // regression: `brownie layer` came back as an ingredient. The prompt said headings exist; it
  // never said a heading is *only* a heading, and the fixture validator has forbidden this all
  // along — the two should agree.
  "A heading is never also an ingredient. Never list a section heading as a line of its own.",
  "If nothing on screen names a dish, the title is null.",
  /*
   * regression: a card whose `serves` field was left blank came back as 12 servings. The
   * no-inventing rule was scoped to ingredient quantities, so every other field was fair game —
   * and an invented serving count silently divides a per-serving calorie figure by a number
   * nobody wrote down.
   */
  "This rule is not only about ingredients: any field the source leaves blank stays null.",
  "If the card does not state how many it serves, servings is null. If it states no time, totalMinutes is null.",
  "Set dishImageIndex to the image that best shows the finished dish.",
].join(" ");

export interface VisionIngredient {
  text: string;
  section: string | null;
  amountEstimated: boolean;
}

export interface VisionPayload {
  title: string | null;
  servings: number | null;
  totalMinutes: number | null;
  ingredientLines: VisionIngredient[];
  steps: string[];
  dishImageIndex: number | null;
}

export type VisionValidation =
  | { ok: true; value: VisionPayload }
  | { ok: false; errors: string[] };

/**
 * Validate the model's output ourselves, as with tier 2.
 *
 * `imageCount` is needed because `dishImageIndex` is only meaningful against the
 * images actually sent. A model returning index 7 for three images is not a crash and
 * not a silent wrong photo — it is a null choice, recorded.
 */
export function validateVisionPayload(value: unknown, imageCount: number): VisionValidation {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["output is not an object"] };
  }
  const candidate = value as Record<string, unknown>;

  const title = candidate.title;
  if (typeof title !== "string") errors.push("title is not a string");
  else if (!title.trim()) errors.push("title is empty");

  for (const field of ["servings", "totalMinutes"] as const) {
    const raw = candidate[field];
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push(`${field} is not a number or null`);
    } else if (raw <= 0) {
      errors.push(`${field} is not positive`);
    }
  }

  const lines = candidate.ingredientLines;
  const ingredients: VisionIngredient[] = [];
  if (!Array.isArray(lines)) {
    errors.push("ingredientLines is not an array");
  } else if (lines.length === 0) {
    errors.push("ingredientLines is empty");
  } else {
    for (const [index, entry] of lines.entries()) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        errors.push(`ingredientLines[${index}] is not an object`);
        continue;
      }
      const line = entry as Record<string, unknown>;
      if (typeof line.text !== "string" || !line.text.trim()) {
        errors.push(`ingredientLines[${index}].text is missing`);
        continue;
      }
      // an absent flag is treated as "not estimated" rather than rejected: a missing
      // boolean is the most likely thing a weaker vision model gets wrong, and
      // escalating the whole extraction over it would waste the good part
      if (line.amountEstimated !== undefined && typeof line.amountEstimated !== "boolean") {
        errors.push(`ingredientLines[${index}].amountEstimated is not a boolean`);
        continue;
      }
      ingredients.push({
        text: line.text.trim(),
        amountEstimated: line.amountEstimated === true,
        section: typeof line.section === "string" ? line.section : null,
      });
    }
  }

  const steps = candidate.steps;
  if (!Array.isArray(steps)) errors.push("steps is not an array");
  else if (steps.some((step) => typeof step !== "string")) {
    errors.push("steps contains a non-string");
  }

  if (errors.length > 0) return { ok: false, errors };

  const rawIndex = candidate.dishImageIndex;
  const dishImageIndex =
    typeof rawIndex === "number" &&
    Number.isInteger(rawIndex) &&
    rawIndex >= 0 &&
    rawIndex < imageCount
      ? rawIndex
      : null;

  return {
    ok: true,
    value: {
      title: (title as string).trim(),
      servings: numberOrNull(candidate.servings),
      totalMinutes: numberOrNull(candidate.totalMinutes),
      ingredientLines: ingredients,
      steps: (steps as string[]).map((step) => step.trim()).filter(Boolean),
      dishImageIndex,
    },
  };
}

/**
 * The image the model picked as the finished dish.
 *
 * Not an `ImportedPhoto`: that type carries a URL, and this photo has none — it came
 * from the user's camera roll, not from a page. Forcing it into the same shape would
 * mean inventing a URL, which is the thing being avoided.
 */
export interface SelectedPhoto {
  /** index into the images that were sent */
  imageIndex: number;
  mediaType: PreparedImage["mediaType"];
  width: number;
  height: number;
  bytes: Uint8Array;
  label?: string;
}

export interface VisionInput {
  images: readonly PreparedImage[];
  cascade: LlmCascade;
  sourceUrl?: string;
  sourceName?: string | null;
}

export interface VisionResult {
  recipe: ExtractedRecipe | null;
  /** the image the model chose as the finished dish, if it chose one */
  photo: SelectedPhoto | null;
  attempts: TierAttempt[];
  usage: LlmUsage[];
}

export async function extractFromImages(input: VisionInput): Promise<VisionResult> {
  const attempts: TierAttempt[] = [];
  const usage: LlmUsage[] = [];
  const models = input.cascade.visionModels ?? [];

  if (input.images.length === 0) {
    attempts.push({ tier: "vision", outcome: "no-data", detail: "no usable images" });
    return { recipe: null, photo: null, attempts, usage };
  }
  if (models.length === 0) {
    // no vision model configured is a refusal, not a fallback to a text model that
    // cannot see
    attempts.push({ tier: "vision", outcome: "no-data", detail: "no vision model configured" });
    return { recipe: null, photo: null, attempts, usage };
  }

  for (const model of models) {
    let response;
    try {
      // the vision provider when there is one, otherwise the same provider as text
      response = await (input.cascade.visionProvider ?? input.cascade.provider).extract({
        model,
        responseSchema: VISION_JSON_SCHEMA,
        instructions: VISION_INSTRUCTIONS,
        // the images carry the recipe; there is no text to add, and nothing about the
        // household could reach this call even if there were
        content: "",
        images: input.images,
      });
    } catch (thrown) {
      attempts.push({
        tier: "vision",
        outcome: "provider-error",
        model: model.model,
        detail: thrown instanceof Error ? thrown.message : String(thrown),
      });
      continue;
    }

    usage.push(response.usage);

    const validated = validateVisionPayload(response.json, input.images.length);
    if (!validated.ok) {
      attempts.push({
        tier: "vision",
        outcome: "invalid-output",
        model: model.model,
        detail: validated.errors.join("; "),
      });
      continue;
    }

    attempts.push({ tier: "vision", outcome: "hit", model: model.model });

    return {
      recipe: {
        title: validated.value.title,
        servings: validated.value.servings,
        totalMinutes: validated.value.totalMinutes,
        ingredients: toIngredients(validated.value.ingredientLines),
        steps: validated.value.steps,
        // no URL: the picture is one of the user's own images, returned as `photo`
        imageUrl: null,
        sourceUrl: input.sourceUrl ?? "",
        sourceName: input.sourceName ?? null,
      },
      photo: toSelectedPhoto(validated.value.dishImageIndex, input.images),
      attempts,
      usage,
    };
  }

  return { recipe: null, photo: null, attempts, usage };
}

/**
 * Parse each line with core, keeping the estimate flag attached to the right one.
 *
 * Line by line rather than `parseIngredientList`, because that discards lines it
 * cannot read — which would shift every following flag onto the wrong ingredient. A
 * misaligned "we guessed this amount" marker is worse than no marker: it tells
 * somebody a number is trustworthy when it is not.
 */
/**
 * A heading, reduced to the words that identify it.
 *
 * The parenthetical goes: a real card writes `Brownie Layer (9x13)` where `(9x13)` labels the
 * second column, not the layer. Two guesses failed before the payload was printed — the first
 * compared text to section as written and missed the suffix, the second required the line to
 * carry no digit and `9x13` sailed straight through the guard meant to catch it.
 */
const asHeading = (text: string) =>
  String(text ?? "")
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .replace(/[:：]\s*$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

export function toIngredients(lines: VisionIngredient[]): ExtractedRecipe["ingredients"] {
  /*
   * A heading is never also an ingredient (decisions §45), enforced here rather than asked for.
   *
   * The prompt says it and the model emitted `brownie layer` as a line anyway, twice, with the
   * instruction present. The fixture validator has forbidden this all along, so the extractor and
   * the validator now agree — and a rule a model may decline is not a rule.
   *
   * Only a line carrying no quantity is dropped: `1 cup orzo` under a section called `ORZO` is a
   * real ingredient, and the validator learned that same lesson the same way.
   */
  const headings = new Set(lines.map((line) => asHeading(line.section ?? "")).filter(Boolean));

  const parsed: ExtractedRecipe["ingredients"] = [];
  for (const line of lines) {
    // a line that is only its own heading, whatever column label trails it
    if (line.section === null && headings.has(asHeading(line.text))) continue;
    const ingredient = parseIngredientLine(line.text);
    if (!ingredient) continue;
    parsed.push({
      ...ingredient,
      ...(line.amountEstimated ? { estimated: true } : {}),
      // the heading rides along with its line (decisions §45)
      ...(line.section === undefined ? {} : { section: line.section }),
    });
  }
  return parsed;
}

function toSelectedPhoto(
  index: number | null,
  images: readonly PreparedImage[],
): SelectedPhoto | null {
  if (index === null) return null;
  const chosen = images[index];
  if (!chosen) return null;
  return {
    imageIndex: index,
    mediaType: chosen.mediaType,
    width: chosen.width,
    height: chosen.height,
    bytes: chosen.bytes,
    ...(chosen.label === undefined ? {} : { label: chosen.label }),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Import a recipe from screenshots.
 *
 * Deliberately **not cached.** The cache is keyed by URL hash and these have no URL;
 * keying by image content instead would mean a shared table whose keys reveal that two
 * households hold the same screenshot, for the benefit of a hit rate that would be
 * close to zero — everybody's crop is slightly different.
 */
export interface VisionImportOptions {
  cascade: LlmCascade;
  preparer: ImagePreparer;
  limits?: ImageLimits;
  sourceUrl?: string;
  sourceName?: string | null;
}

export type VisionImportOutcome =
  | {
      ok: true;
      recipe: ExtractedRecipe;
      photo: SelectedPhoto | null;
      tier: "vision";
      attempts: TierAttempt[];
      usage: LlmUsage[];
      /** images that could not be sent, with why — never silently dropped */
      rejected: PrepareFailure[];
    }
  | { ok: false; failure: ImportFailure; attempts: TierAttempt[]; rejected: PrepareFailure[] };

export async function importFromImages(
  images: readonly SourceImage[],
  options: VisionImportOptions,
): Promise<VisionImportOutcome> {
  if (!options.cascade.visionModels || options.cascade.visionModels.length === 0) {
    // said plainly rather than as "no recipe found": nothing was attempted, and the
    // fix is a config change rather than a better screenshot
    return {
      ok: false,
      failure: { kind: "vision-not-configured" },
      attempts: [],
      rejected: [],
    };
  }

  const { images: prepared, rejected } = await options.preparer.prepare(images, options.limits);
  if (prepared.length === 0) {
    return {
      ok: false,
      failure: { kind: "no-usable-images", rejected },
      attempts: [],
      rejected,
    };
  }

  const result = await extractFromImages({
    images: prepared,
    cascade: options.cascade,
    ...(options.sourceUrl === undefined ? {} : { sourceUrl: options.sourceUrl }),
    ...(options.sourceName === undefined ? {} : { sourceName: options.sourceName }),
  });

  if (!result.recipe || missingFields(result.recipe).length > 0) {
    return {
      ok: false,
      failure: {
        kind: "no-recipe-found",
        url: options.sourceUrl ?? "",
        triedTiers: ["vision"],
      },
      attempts: result.attempts,
      rejected,
    };
  }

  return {
    ok: true,
    recipe: result.recipe,
    photo: result.photo,
    tier: "vision",
    attempts: result.attempts,
    usage: result.usage,
    rejected,
  };
}
