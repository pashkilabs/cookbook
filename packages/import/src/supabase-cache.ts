import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedRecipe, ImportCache } from "./types.js";

/**
 * `import_cache` as the shared cache.
 *
 * Keyed by URL hash and **not by family**: a recipe that goes round Facebook is
 * fetched and parsed once for the entire user base, which at subscription scale
 * matters more than model choice (architecture §11).
 *
 * Requires the **service role**. The table has RLS enabled with no policies and no
 * client grant, so no ordinary caller can read it — the import service is the only
 * thing that touches it.
 *
 * Nothing household-identifying goes in. That is what keeps a shared table from
 * becoming a cross-tenant leak, and it is why the cached value is the extracted
 * recipe rather than anything about who asked for it.
 */
export function createSupabaseImportCache(supabase: SupabaseClient): ImportCache {
  return {
    async get(urlHash: string): Promise<ExtractedRecipe | null> {
      const { data, error } = await supabase
        .from("import_cache")
        .select("extracted_json")
        .eq("url_hash", urlHash)
        .maybeSingle();
      if (error) throw error;
      const stored = data?.extracted_json;
      return isExtractedRecipe(stored) ? stored : null;
    },

    async put(urlHash: string, recipe: ExtractedRecipe): Promise<void> {
      const { error } = await supabase.from("import_cache").upsert(
        {
          url_hash: urlHash,
          extracted_json: recipe as unknown as Record<string, unknown>,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "url_hash" },
      );
      if (error) throw error;
    },
  };
}

/**
 * Validate on the way out, not just on the way in.
 *
 * A cached value was written by an older version of this package, and a shape change
 * would otherwise surface as an undefined field deep in the review screen. Anything
 * that does not look like a recipe is treated as a miss and re-fetched.
 */
function isExtractedRecipe(value: unknown): value is ExtractedRecipe {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === "string" &&
    Array.isArray(candidate.ingredients) &&
    Array.isArray(candidate.steps) &&
    typeof candidate.sourceUrl === "string"
  );
}
