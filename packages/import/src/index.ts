/**
 * @pashki/import — server-side recipe import, deterministic tiers only.
 *
 * Tier 0 reads the structured recipe data a page publishes. Tier 1 reads microdata
 * and recipe-plugin markup. Both are free, instant, and more accurate than a model,
 * because they read what the site said rather than interpreting it (decisions §6).
 *
 * No model calls. Tiers 2 (LLM over page text) and 3 (vision) plug in behind the
 * same `ImportOutcome`, and cannot be judged until the eval set has real fixtures.
 *
 * Server-only: a browser cannot fetch other websites, and the cache needs the
 * service role.
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
