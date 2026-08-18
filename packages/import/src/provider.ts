/**
 * Tier 2: one provider interface, model as a config value.
 *
 * Decisions §7 puts every model behind a single interface precisely so that
 * switching one is a config change rather than a code path — the landscape moved
 * materially in six months and will again. Nothing in this file names a production
 * model, and nothing in it is tuned: **both need the eval fixtures, which do not
 * exist yet.** The placeholder in `PLACEHOLDER_CASCADE` is a stand-in to make the
 * cascade runnable, not a recommendation.
 *
 * **Server-side only.** An inference key must never reach a client bundle
 * (CLAUDE.md), which is why this lives in a package the boundary guard keeps out of
 * client contexts.
 */

/** Which model to call. A second model is a row here, never a branch in code. */
export interface ModelConfig {
  /** provider key, e.g. "openai" — resolved by whatever wires up an LlmProvider */
  provider: string;
  /** the model identifier the provider expects */
  model: string;
  /** US-hosted only, per decisions §7. Recorded so a config can be audited. */
  region: "us";
  /** low for extraction: this is transcription, not composition */
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * An image to send. Bytes plus the media type the provider should declare — a
 * provider base64s it however its API wants.
 */
export interface ImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
}

export interface LlmRequest {
  model: ModelConfig;
  /**
   * The schema the output MUST satisfy.
   *
   * A provider is required to enforce this with its structured-output mode, not to
   * pass it along in a prompt and hope. A prompt asking politely for JSON produces
   * prose apologies at the worst moment, and the whole point of tier 2 is that its
   * output is machine-checkable.
   */
  responseSchema: JsonSchema;
  /** how to behave. Carries no recipe content and no household data. */
  instructions: string;
  /**
   * The material to extract from — page text or a pasted caption, and nothing else.
   *
   * Prompts carry recipe content only. Never names, emails, children's names or
   * ratings (CLAUDE.md). That is what keeps the compliance surface small, and it is
   * structural here: the only things this function can see are a URL and text taken
   * from a third-party page.
   */
  content: string;
  /**
   * Images, for tier 3.
   *
   * On the same interface rather than a separate `extractFromImages` method, so a
   * vision model is a config value and not a second code path — the difference
   * between tier 2 and tier 3 is which `ModelConfig` list the cascade reaches for,
   * and whether this array is populated.
   *
   * Several images are sent in **one** call on purpose: a reel splits its recipe
   * across the on-screen card, the caption and a pinned comment, and fusing them is
   * the job. Three separate extractions would produce three partial recipes and leave
   * the merging to code that cannot see the pictures.
   */
  images?: readonly ImageInput[];
}

export interface LlmUsage {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface LlmResponse {
  /** already parsed. A provider that cannot produce JSON should throw. */
  json: unknown;
  usage: LlmUsage;
}

/**
 * The seam. One method, because extraction is the only thing tier 2 does.
 *
 * An implementation is expected to: use the provider's enforced-JSON mode against
 * `responseSchema`, keep the key server-side, and throw on transport failure so the
 * cascade can escalate.
 */
export interface LlmProvider {
  readonly key: string;
  extract(request: LlmRequest): Promise<LlmResponse>;
}

/** A cascade: try each model in turn, escalating when the output will not validate. */
export interface LlmCascade {
  provider: LlmProvider;
  /** in order. The first is the workhorse; later entries are escalation. */
  models: ModelConfig[];
  /**
   * Models that accept images, in the same escalation order. Absent means tier 3 is
   * not configured and screenshots are refused rather than guessed at.
   *
   * A separate list rather than a flag on the models above, because the escalation
   * order for vision is its own question — decisions §7 puts vision on different
   * models from the text workhorse.
   */
  visionModels?: ModelConfig[];
  /**
   * The provider for images, when it is not the one above.
   *
   * Vision and text are different questions with different answers (§7), and they turned out to
   * need different *wire protocols* too: the text workhorse is on Together speaking Chat
   * Completions, and Anthropic — the only thing measured to read a handwritten card — speaks
   * `/v1/messages` with a forced tool call. Defaults to `provider`, so a cascade that uses one
   * for both needs no change.
   */
  visionProvider?: LlmProvider;
}

/**
 * A placeholder cascade so the code runs.
 *
 * **This is not a model recommendation.** Choosing one is a measurement, and the
 * eval harness that would make it is built but has three placeholder fixtures. The
 * names come from the routing table in decisions §7, which is itself an August 2026
 * snapshot due for re-benchmarking. Replace this once there are real fixtures — and
 * expect the answer to differ from the table.
 */
export const PLACEHOLDER_CASCADE: ModelConfig[] = [
  { provider: "openai", model: "gpt-5.6-luna", region: "us", temperature: 0 },
  // escalation, on schema-validation failure only
  { provider: "anthropic", model: "claude-haiku-4-5", region: "us", temperature: 0 },
];

/**
 * Placeholder vision cascade. **Also not a recommendation.**
 *
 * Vision is the weakest link in the cascade (decisions §7): stylised text over food
 * is materially harder than document OCR, and the input — a phone screenshot of a
 * reel — is the worst material in the product. Expect real fixtures to show that, and
 * expect this list to change more than the text one.
 */
export const PLACEHOLDER_VISION_CASCADE: ModelConfig[] = [
  { provider: "google", model: "gemini-flash-lite", region: "us", temperature: 0 },
  { provider: "anthropic", model: "claude-haiku-4-5", region: "us", temperature: 0 },
];

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

export type JsonSchema = Record<string, unknown>;

/**
 * What tier 2 must return.
 *
 * Note what it does **not** ask for: parsed amounts and units. The model returns
 * ingredient lines verbatim and `packages/core` parses them, because core's parser
 * is already tested against the awkward real shapes — `1 (14.5 oz) can`,
 * `2 to 3 cloves`, `T` versus `t` — and a model re-deriving that is a second
 * implementation to keep honest. It also means tier 0, tier 1 and tier 2 all produce
 * ingredients through the same code, so an eval comparison between tiers measures
 * extraction rather than two different parsers.
 *
 * Whether that is the right split is exactly the sort of thing the eval set is for.
 */
export const RECIPE_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "servings", "totalMinutes", "ingredientLines", "steps", "course", "cuisine"],
  properties: {
    title: {
      type: ["string", "null"],
      // a caption that reads "here are the toast details" names no dish, and a model that
      // supplies one has invented it — the same fault as inventing an amount (decisions §46)
      description: "The recipe's name as the source gives it. null if the source names no dish.",
    },
    servings: {
      type: ["integer", "null"],
      description: "How many people it serves. null if the source does not say.",
    },
    totalMinutes: {
      type: ["integer", "null"],
      description: "Total time in minutes. null if the source does not say.",
    },
    ingredientLines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "section"],
        properties: {
          text: {
            type: "string",
            description:
              "The ingredient exactly as written, including amount and unit. Do not reformat, convert, or infer an amount that is not stated.",
          },
          section: {
            type: ["string", "null"],
            // §45: the heading is a label on the line. 153 checks in the eval score zero
            // without it, and a caption's headings are right there in the text.
            description:
              "The heading this ingredient sat under, verbatim, e.g. 'For the sauce'. null if the recipe has no sections.",
          },
        },
      },
      description: "Every ingredient, in order, each with the heading it appeared under.",
    },
    steps: {
      type: "array",
      items: { type: "string" },
      description: "The method, one instruction per entry, in order.",
    },
    course: {
      type: ["string", "null"],
      enum: ["breakfast", "starter", "main", "side", "dessert", "drink", "snack", null],
      description: "Which course this dish is, or null if it is not clear.",
    },
    cuisine: {
      type: ["string", "null"],
      description: "The cuisine, as a short common name — Italian, Thai, Mexican — or null.",
    },
  },
};

/** The instructions. Deliberately terse and untuned — tuning needs fixtures. */
export const EXTRACTION_INSTRUCTIONS = [
  "Extract the recipe from the text below into the given JSON schema.",
  "Copy ingredient lines verbatim, including the amount and unit as written.",
  "Give each ingredient the heading it appeared under, verbatim, or null if there are none.",
  "A heading is never itself an ingredient.",
  "If the source names no dish, the title is null. Do not invent one.",
  "Temperatures and equipment are not ingredients.",
  "Never invent an amount the text does not state.",
  "If the text contains no recipe, return an empty ingredientLines array.",
  // regression: eight instructions, every one about ingredients, and `steps` came back empty
  // from every caption tested — including one with a "DIRECTIONS:" heading and a numbered list.
  // The model was doing exactly what it was told. A schema field is not a request.
  "Also extract the method, one instruction per entry, in order, in steps.",
  "The method may carry no heading and no numbers at all — it is often a plain paragraph after",
  "the ingredients, or a run of lines each starting with an emoji. Split it into its steps.",
  "Copy each step's wording; do not summarise, renumber, or drop the emoji's sentence.",
  "If the text truly gives no method, return an empty steps array rather than inventing one.",
  // free from a model already reading the recipe: "MARRY ME ITALIAN SAUSAGE SOUP" gives both.
  // Null rather than a guess, for the same reason an amount is never invented — a wrong label
  // that looks confident is worse than an absent one, and the review screen is where it is fixed.
  /*
   * Two fields, two rules, because one caution rule governing both broke both: course declined
   * on obvious mains (a chicken wrap, a shrimp orzo) *and* called a soup a snack. Measured as
   * three outcomes — right, declined, wrong — because averaging a decline with a wrong answer
   * moves the prompt one way while the other error gets worse and nothing shows it.
   */
  "Say which course the dish is. Course is almost always answerable from the dish itself:",
  "anything substantial enough to be the centre of a meal is a main, including soups, stews,",
  "pasta, curries, wraps and bowls. A sweet baked thing is a dessert or a breakfast, never a",
  "snack. Use snack only for something small and savoury eaten between meals, and",
  "starter or side only when the source says so. Answer null only if you genuinely cannot tell.",
  "Cuisine is the opposite: null unless the text names it or the dish is unmistakably of one",
  "tradition. Do not guess from a single ingredient — olive oil does not make a recipe Italian —",
  "and never answer with a region: Thai, not Asian.",
].join(" ");

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface RecipePayload {
  title: string | null;
  servings: number | null;
  totalMinutes: number | null;
  ingredientLines: { text: string; section: string | null }[];
  steps: string[];
  course: string | null;
  cuisine: string | null;
}

export type ValidationResult =
  | { ok: true; value: RecipePayload }
  | { ok: false; errors: string[] };

/**
 * Validate the model's output against the schema, in our own code.
 *
 * The provider is asked to enforce the schema and is not trusted to have done it. A
 * structured-output mode that silently degrades, a proxy that rewrites the response,
 * or a provider that simply has a bad day all produce output that looks close
 * enough to cause damage downstream. This is the check that decides whether to
 * escalate.
 *
 * Hand-written rather than a validator dependency: the schema is five fields, and
 * the errors it produces are what the escalation records, so they should read like
 * something a person can act on.
 */
export function validateRecipePayload(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["output is not an object"] };
  }
  const candidate = value as Record<string, unknown>;

  /*
   * null is a valid answer: a caption reading "here are the toast details" names no dish, and a
   * model that supplies one has invented it (decisions §46). An empty string is not the same
   * claim — that is a field the model failed to fill, and it escalates.
   */
  const title = candidate.title;
  if (title !== null && typeof title !== "string") errors.push("title is not a string or null");
  else if (typeof title === "string" && !title.trim()) errors.push("title is empty");

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
  const isLine = (line: unknown): boolean =>
    typeof line === "object" && line !== null &&
    typeof (line as { text?: unknown }).text === "string" &&
    ((line as { section?: unknown }).section === null ||
      typeof (line as { section?: unknown }).section === "string");
  if (!Array.isArray(lines)) {
    errors.push("ingredientLines is not an array");
  } else if (!lines.every(isLine)) {
    errors.push("ingredientLines contains an entry that is not { text, section }");
  } else if (lines.length === 0) {
    // a recipe with no ingredients is not a recipe. Reported as a validation
    // failure so the cascade escalates rather than saving an empty shell.
    errors.push("ingredientLines is empty");
  }

  const steps = candidate.steps;
  if (!Array.isArray(steps)) errors.push("steps is not an array");
  else if (steps.some((step) => typeof step !== "string")) {
    errors.push("steps contains a non-string");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title: typeof title === "string" ? title.trim() : null,
      servings: numberOrNull(candidate.servings),
      totalMinutes: numberOrNull(candidate.totalMinutes),
      ingredientLines: (lines as { text: string; section: string | null }[])
        .filter((line) => line.text.trim().length > 0)
        .map((line) => ({ text: line.text.trim(), section: line.section })),
      steps: (steps as string[]).map((step) => step.trim()).filter(Boolean),
      // an unrecognised course is dropped rather than rejected: a model offering "brunch" has
      // still read the recipe correctly, and failing the whole extraction over a label would
      // escalate to a pricier model to fix a field the review screen can set in one tap
      course: COURSES.has(String(candidate.course)) ? String(candidate.course) : null,
      cuisine: trimmedOrNull(candidate.cuisine),
    },
  };
}

/** the closed list the column's CHECK enforces — kept here so a bad label never reaches it */
const COURSES = new Set(["breakfast", "starter", "main", "side", "dessert", "drink", "snack"]);

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // 40 is the column's limit; a model writing a sentence has not answered the question
  return trimmed.length > 0 && trimmed.length <= 40 ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}
