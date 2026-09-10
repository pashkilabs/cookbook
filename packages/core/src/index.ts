export * from "./types.js";
export * from "./units.js";
export * from "./text.js";
export * from "./parse.js";
export * from "./catalog.js";
export * from "./format.js";
export * from "./consolidate.js";
export * from "./calories.js";
export {
  METRIC_PACKAGES,
  SEED_CATALOG,
  metricPackageCoverage,
  seedCatalogFor,
} from "./seed-catalog.js";
export * from "./substitutions.js";

export { readTastes, tasteSummary, evidence, ENOUGH_TO_SAY, ENOUGH_TO_MENTION } from "./tastes.js";
export type { TasteReading, TasteState, TasteDimension, RatingObservation } from "./tastes.js";

export { consensusPartition, partitionAgreement } from "./partitions.js";
export type { Consensus, Partitioned } from "./partitions.js";

export {
  collagenWarnings,
  collagenRichCut,
  longestSustainedMinutes,
  COLLAGEN_RICH_CUTS,
  SUSTAINED_MINUTES_NEEDED,
} from "./collagen.js";
export type { CompatibilityWarning } from "./collagen.js";

export { compatibilityReport, COMPONENT_TRUST, READINGS_NEEDED } from "./compatibility.js";
export type { CompatibilityReport, ComponentClaims } from "./compatibility.js";

export { fingerprint } from "./fingerprint.js";

export { composeBlend, partIsIntact, servingsDisagreement } from "./blend.js";
export type { BlendLine, BlendPart, ComposedBlend, ComposedPart } from "./blend.js";
