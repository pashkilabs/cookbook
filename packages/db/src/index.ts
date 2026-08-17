/**
 * The package's type surface.
 *
 * `database.types.ts` is generated from a running database — never edited by hand.
 * Regenerate after any migration:
 *
 *   pnpm --filter @pashki/db db:reset && pnpm --filter @pashki/db gen:types
 */
import type { Database } from "./database.types.js";

export type { Database, Json } from "./database.types.js";

type Tables = Database["public"]["Tables"];

/** A row as it comes back from a select: `Row<"recipes">`. */
export type Row<T extends keyof Tables> = Tables[T]["Row"];

/** What an insert accepts — defaults and generated columns optional. */
export type Insert<T extends keyof Tables> = Tables[T]["Insert"];

/** What an update accepts — every column optional. */
export type Update<T extends keyof Tables> = Tables[T]["Update"];

/**
 * Tables the recipe app owns and may query directly.
 *
 * `import_cache` is here because the import service owns it, but note it is
 * shared across the whole user base rather than scoped to a household, and it is
 * reachable only with the service role.
 */
export const APP_TABLES = [
  "recipes",
  "recipe_ingredients",
  "recipe_steps",
  "ingredients",
  "grocery_packages",
  // reference data, like grocery_packages: readable by every household, writable by none
  "ingredient_containers",
  "ratings",
  "meal_plans",
  "plan_entries",
  "shortlist_entries",
  "pantry_items",
  "shopping_ticks",
  "shopping_ticks",
  "photos",
  "import_jobs",
  "import_cache",
] as const;

export type AppTable = (typeof APP_TABLES)[number];

/**
 * Platform tables. App code must not query these — it goes through
 * packages/platform-client (docs/decisions.md §10). Exported so that boundary can
 * be asserted in a lint rule or a test rather than only remembered.
 */
export const PLATFORM_TABLES = [
  "accounts",
  "families",
  "family_members",
  "devices",
  "subscriptions",
  "entitlements",
  "invitations",
] as const;

export type PlatformTable = (typeof PLATFORM_TABLES)[number];

export type TableName = AppTable | PlatformTable;

// the two lists together must account for every table in the schema; if a
// migration adds one and neither list mentions it, this stops compiling
type UnlistedTable = Exclude<keyof Tables, TableName>;
type NoUnlistedTables = [UnlistedTable] extends [never] ? true : UnlistedTable;
export const EVERY_TABLE_IS_CLASSIFIED: NoUnlistedTables = true;

/** Household-scoped tables: every one carries family_id and has four RLS policies. */
export const HOUSEHOLD_TABLES = [
  "recipes",
  "recipe_ingredients",
  "recipe_steps",
  "ratings",
  "meal_plans",
  "plan_entries",
  "shortlist_entries",
  "pantry_items",
  "shopping_ticks",
  "photos",
  "import_jobs",
] as const satisfies readonly AppTable[];

export type HouseholdTable = (typeof HOUSEHOLD_TABLES)[number];

/**
 * Tables with no family_id, and why.
 *
 * The catalog is global reference data — cream comes in pints regardless of whose
 * kitchen it is. The cache is keyed by URL hash so a recipe doing the rounds is
 * fetched once for the entire user base.
 */
export const UNSCOPED_TABLES = {
  ingredients: "catalog: global reference data, readable by any signed-in user",
  grocery_packages: "catalog: global reference data, readable by any signed-in user",
  import_cache: "shared cache keyed by URL hash; service role only, no policies",
} as const satisfies Record<string, string>;
