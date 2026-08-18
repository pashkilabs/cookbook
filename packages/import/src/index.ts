/**
 * @pashki/import — server-side recipe import.
 *
 * Tier 0 reads the structured recipe data a page publishes. Tier 1 reads microdata
 * and recipe-plugin markup. Both are free, instant, and more accurate than a model,
 * because they read what the site said rather than interpreting it (decisions §6).
 * Tier 2 is a schema-constrained model, reached only when those found nothing and a
 * cascade was passed in. Tier 3 (vision) is not built.
 *
 * The tier-2 model is **not chosen and the prompt is not tuned**: both are
 * measurements, and the eval set still holds placeholder fixtures.
 *
 * Server-only: a browser cannot fetch other websites, the cache needs the service
 * role, and an inference key must never reach a client bundle.
 */
export * from "./types.js";
export { importRecipe } from "./pipeline.js";
export { createHttpFetcher, type HttpFetcherOptions } from "./fetcher.js";
export {
  absoluteUrl,
  blockedPlatform,
  hashUrl,
  normaliseUrl,
  type NormalisedUrl,
} from "./url.js";
export { decodeImage, type DecodedImage, type ImageFormat } from "./image.js";
export {
  durationToMinutes,
  mapRecipeNode,
  missingFields,
  parseImageUrl,
  parseServings,
  parseSteps,
  toStringArray,
  type MapOptions,
} from "./recipe.js";
export {
  buildNodeIndex,
  collectJsonLd,
  findRecipeNode,
  flattenNodes,
  isBareReference,
  resolveRef,
  typesOf,
  type JsonObject,
  type JsonValue,
} from "./jsonld.js";
export { extractMicrodata, extractSiteName } from "./microdata.js";
export {
  CACHE_MAX_AGE_DAYS,
  EXTRACTOR_VERSION,
  cacheStaleness,
  isCacheEntryFresh,
  type CacheEntryAge,
  type CacheStaleness,
} from "./cache-policy.js";
export {
  EXTRACTION_INSTRUCTIONS,
  PLACEHOLDER_CASCADE,
  PLACEHOLDER_VISION_CASCADE,
  RECIPE_JSON_SCHEMA,
  validateRecipePayload,
  type ImageInput,
  type JsonSchema,
  type LlmCascade,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
  type ModelConfig,
  type RecipePayload,
  type ValidationResult,
} from "./provider.js";
export { extractWithLlm, pageToText, type Tier2Input, type Tier2Result } from "./tier2.js";
export { createImportExtractor, type ImportExtractorOptions } from "./eval-extractor.js";
export {
  drainQueue,
  runNextJob,
  type ClaimableKind,
  type FinishJobInput,
  type ImportJob,
  type JobOutcome,
  type JobQueue,
  type JobResult,
  type JobRunnerOptions,
  type FinishOutcome,
  type StoredPhotoRef,
} from "./job-runner.js";
export {
  DEFAULT_IMAGE_LIMITS,
  createPassthroughImagePreparer,
  type ImageLimits,
  type ImagePreparer,
  type PrepareFailure,
  type PrepareResult,
  type PreparedImage,
  type SourceImage,
} from "./prepare-image.js";
export {
  VISION_INSTRUCTIONS,
  VISION_JSON_SCHEMA,
  extractFromImages,
  importFromImages,
  toIngredients,
  validateVisionPayload,
  type SelectedPhoto,
  type VisionImportOptions,
  type VisionImportOutcome,
  type VisionIngredient,
  type VisionInput,
  type VisionPayload,
  type VisionResult,
  type VisionValidation,
} from "./vision.js";
export { cascadeFromEnv, createOpenAiCompatibleProvider, providerFromEnv } from "./openai-compatible.js";
export { acceptsTemperature, anthropicModelMismatch } from "./anthropic.js";
export { classifyRecipe, classificationPrompt, CLASSIFICATION_COLUMNS, CLASSIFY_JSON_SCHEMA, CLASSIFY_INSTRUCTIONS } from "./classify.js";
export type { RecipeClassification } from "./classify.js";
export { detectOrientation, ORIENTATIONS, ORIENTATION_INSTRUCTIONS, ORIENTATION_JSON_SCHEMA } from "./orientation.js";
export type { Orientation, OrientationReading } from "./orientation.js";
export type { OpenAiCompatibleOptions } from "./openai-compatible.js";
export { createAnthropicProvider, visionProviderFromEnv } from "./anthropic.js";
export type { AnthropicOptions } from "./anthropic.js";
