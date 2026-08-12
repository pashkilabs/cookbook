/**
 * The package's type surface.
 *
 * Concrete row types come from `src/database.types.ts`, which is generated from a
 * running database (`pnpm --filter @pashki/db gen:types`) and is therefore not
 * committed yet — see README, "Known gaps". Generating it is a one-command step;
 * fabricating it by hand would produce a file that claims to be generated and
 * drifts from the schema silently.
 *
 * Once generated, add:
 *
 *   import type { Database } from "./database.types.js";
 *   export type { Database, Json } from "./database.types.js";
 *   type Tables = Database["public"]["Tables"];
 *   export type Row<T extends TableName> = Tables[T]["Row"];
 *   export type Insert<T extends TableName> = Tables[T]["Insert"];
 *   export type Update<T extends TableName> = Tables[T]["Update"];
 */

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
  "ingredients",
  "grocery_packages",
  "ratings",
  "meal_plans",
  "plan_entries",
  "shortlist_entries",
  "pantry_items",
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
] as const;

export type PlatformTable = (typeof PLATFORM_TABLES)[number];

export type TableName = AppTable | PlatformTable;

/** Household-scoped tables: every one carries family_id and has four RLS policies. */
export const HOUSEHOLD_TABLES = [
  "recipes",
  "recipe_ingredients",
  "ratings",
  "meal_plans",
  "plan_entries",
  "shortlist_entries",
  "pantry_items",
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
