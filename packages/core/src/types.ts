/**
 * Base units per dimension:
 *   volume -> millilitres   weight -> grams
 *   count | clove | can | bunch -> whole items
 */
export type Dimension = "volume" | "weight" | "count" | "clove" | "can" | "bunch";

export interface UnitDef {
  dimension: Dimension;
  /** multiplier to reach the dimension's base unit */
  toBase: number;
}

/** A quantity expressed in a dimension's base unit. */
export interface Measure {
  amount: number;
  dimension: Dimension;
}

/** One line of a recipe's ingredient list, after parsing. */
export interface ParsedIngredient {
  /** null when the line states no quantity ("salt to taste") */
  amount: number | null;
  /** canonical unit key, or null for whole countable things ("2 onions") */
  unit: string | null;
  item: string;
  note: string;
  /** true when the amount was inferred rather than stated — surfaced for review */
  estimated?: boolean;
  /** the original text, kept for display and debugging */
  raw: string;
}

export type MeasurementSystem = "us" | "metric";

export interface PackageSize {
  label: string;
  /** size in the dimension's base unit */
  amount: number;
  /**
   * Which market sells it in this size. Absent means US, which is what every size predating the
   * preference was.
   *
   * Sizes differ by market, not just their wording: a pint is 473 ml and a metric carton is 500,
   * so these are separate rows rather than one row with two labels (decisions §28).
   */
  system?: MeasurementSystem;
}

/**
 * How a grocery item is actually sold. Seeded in code today, a database
 * table in production — nothing here may be referenced by identity.
 */
export interface CatalogItem {
  key: string;
  /** canonical name first, then aliases; matched longest-first */
  names: string[];
  aisle: string;
  dimension: Dimension;
  packages: PackageSize[];
  /** grams per cup — lets volume measures merge into a weight-sold item */
  gramsPerCup?: number;
  /** base-unit contents of one tin, so "1 can beans" becomes a real weight */
  canSize?: number;
}

/** One recipe (or one planned meal) feeding into a shopping list. */
export interface ConsolidationEntry {
  /** shown against the ingredient, e.g. the recipe title */
  label: string;
  /** groups uses for display, e.g. a day index or date */
  groupKey?: string | number;
  ingredients: ParsedIngredient[];
  /** batch multiplier, e.g. 1.5 to cook half again as much */
  scale?: number;
}

export interface IngredientUse {
  label: string;
  groupKey?: string | number;
  /** contribution in base units */
  amount: number;
  /** as the recipe wrote it, e.g. "1½ cup" */
  display: string;
}

export interface ShoppingLine {
  key: string;
  label: string;
  aisle: string;
  dimension: Dimension;
  /** total required, in base units, after scaling and pantry deduction */
  needed: number;
  neededDisplay: string;
  /** null when the item isn't in the catalog — buy what the recipes say */
  packages: Array<{ size: PackageSize; count: number }> | null;
  packagesDisplay: string | null;
  /** total bought, in base units */
  capacity: number;
  leftover: number;
  leftoverDisplay: string | null;
  uses: IngredientUse[];
  /** already on hand; kept on the list but flagged */
  inPantry: boolean;
  /** measures that couldn't merge into the primary dimension */
  otherDimensions: Array<{ dimension: Dimension; amount: number; display: string }>;
}

export interface PantryEntry {
  name: string;
  amount?: number;
  unit?: string | null;
}

export interface ConsolidateOptions {
  pantry?: PantryEntry[];
  /** drop salt, pepper, water and friends from the list */
  excludeStaples?: boolean;
  /** subtract pantry quantities where they are known */
  deductPantry?: boolean;
}
