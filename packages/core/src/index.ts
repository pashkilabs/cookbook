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

export { readTastes, tasteSummary, evidence, isTelling, TELLING_DIMENSIONS, ENOUGH_TO_SAY, ENOUGH_TO_MENTION } from "./tastes.js";
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

export { recipesSharingBase, baseIngredients, asIngredients, SHARED_FOR_A_BASE } from "./bases.js";
export type { SharedBase } from "./bases.js";

export { linesCoveredByBase } from "./bases.js";
export {
  ALLERGENS,
  readAllergen,
  readAllergens,
  type Allergen,
  type AllergenReading,
  type AllergenVerdict,
} from "./allergens.js";
export {
  readForHousehold,
  readForMember,
  type HouseholdReading,
  type InferredPreference,
  type MemberReading,
  type RecipeSubjects,
  type Stance,
  type StatedPreference,
  type SubjectKind,
} from "./preferences.js";
export {
  INSTACART_UNITS,
  buildShoppingListRequest,
  searchBranches,
  type InstacartLineItem,
  type InstacartMeasurement,
  type ShoppingListOptions,
  type ShoppingListRequest,
  type WithheldLine,
} from "./instacart.js";

/*
 * One list of proteins, read by the column's CHECK test, both model schemas, both validation
 * sets, the chips, the form and the chapters — because it was spelled out in nine places and a
 * value present in some of them is silently dropped or silently invisible.
 */
export {
  PRINCIPAL_PROTEINS,
  PRINCIPAL_PROTEIN_ENUM,
  isPrincipalProtein,
  type PrincipalProtein,
} from "./proteins.js";

export { consensusLabels, type LabelConsensus } from "./consensus.js";
