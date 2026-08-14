import type { SupabaseClient } from "@supabase/supabase-js";
import type { CachedImport, ExtractedRecipe, ImportCache, Tier } from "./types.js";
import { EXTRACTOR_VERSION, cacheStaleness } from "./cache-policy.js";

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
    async get(urlHash: string): Promise<CachedImport | null> {
      const { data, error } = await supabase
        .from("import_cache")
        .select("extracted_json, fetched_at, extractor_version")
        .eq("url_hash", urlHash)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      /*
       * Staleness is decided here rather than in the pipeline because this is where the two
       * columns live, and the pipeline should not learn the storage shape to ask a question
       * about it. The policy itself is pure and tested on its own — see `cache-policy.ts`.
       *
       * A stale row is a *miss*, not a delete: the next successful extraction upserts over it,
       * so the row is replaced by the thing that made it stale rather than by a second write.
       */
      const staleness = cacheStaleness({
        extractorVersion: data.extractor_version as number | null,
        fetchedAt: data.fetched_at as string | null,
      });
      if (staleness !== "fresh") return null;

      return toCachedImport(data.extracted_json);
    },

    async put(urlHash: string, entry: CachedImport): Promise<void> {
      const { error } = await supabase.from("import_cache").upsert(
        {
          url_hash: urlHash,
          extracted_json: entry as unknown as Record<string, unknown>,
          fetched_at: new Date().toISOString(),
          // what makes a future correction able to reach this row
          extractor_version: EXTRACTOR_VERSION,
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
function toCachedImport(value: unknown): CachedImport | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const tier = candidate.tier;
  if (tier !== "structured-data" && tier !== "microdata" && tier !== "llm") return null;
  return isExtractedRecipe(candidate.recipe) ? { recipe: candidate.recipe, tier: tier as Tier } : null;
}

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
