import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readLocalInstance } from "@pashki/db/test-support";
import { hashUrl, importRecipe, normaliseUrl } from "../src/index.js";
import { createSupabaseImportCache } from "../src/supabase-cache.js";
import { PAGE_WITH_IMAGE_REFERENCE, createFakeFetcher, jpegBytes } from "./fixtures.js";

/**
 * The cache against the real `import_cache` table.
 *
 * The fake cache proves the pipeline uses a cache; this proves the table it will
 * actually use round-trips a recipe and is keyed by URL hash rather than by family.
 */
const instance = readLocalInstance();
const PIE = "https://cache-test.example.com/pie";
const IMAGE = "https://cdn.example.com/pie.jpg";

describe.skipIf(instance === null)("supabase import cache", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let urlHash: string;

  beforeAll(() => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anon = createClient(instance.url, instance.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const normalised = normaliseUrl(PIE);
    if ("kind" in normalised) throw new Error("bad fixture URL");
    urlHash = hashUrl(normalised.href);
  });

  afterAll(async () => {
    if (!instance) return;
    await admin.from("import_cache").delete().eq("url_hash", urlHash);
  });

  const fetcher = () =>
    createFakeFetcher(
      { [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } },
      { [IMAGE]: { bytes: jpegBytes() } },
    );

  it("populates the table on a miss", async () => {
    const cache = createSupabaseImportCache(admin);
    const result = await importRecipe(PIE, { fetcher: fetcher(), cache });
    expect(result.ok && result.fromCache).toBe(false);

    const { data } = await admin
      .from("import_cache")
      .select("url_hash, extracted_json, fetched_at")
      .eq("url_hash", urlHash)
      .single();
    expect(data?.url_hash).toBe(urlHash);
    expect((data?.extracted_json as { title: string }).title).toBe("Apple Pie");
  });

  it("is hit on a repeat, without fetching", async () => {
    const cache = createSupabaseImportCache(admin);
    // a fetcher with no fixtures: any request would throw
    const empty = createFakeFetcher({});
    const result = await importRecipe(PIE, { fetcher: empty, cache });
    expect(result.ok && result.fromCache).toBe(true);
    expect(empty.pageCalls).toEqual([]);
    if (result.ok) {
      expect(result.recipe.ingredients).toHaveLength(3);
      expect(result.recipe.steps).toHaveLength(2);
    }
  });

  it("holds one row for the same page shared four different ways", async () => {
    const cache = createSupabaseImportCache(admin);
    for (const variant of [
      `${PIE}?utm_source=facebook`,
      `${PIE}/`,
      `${PIE}#jump-to-recipe`,
      PIE.replace("https://", "http://"),
    ]) {
      const result = await importRecipe(variant, { fetcher: createFakeFetcher({}), cache });
      expect(result.ok && result.fromCache, variant).toBe(true);
    }
    const { count } = await admin
      .from("import_cache")
      .select("url_hash", { count: "exact", head: true })
      .eq("url_hash", urlHash);
    expect(count).toBe(1);
  });

  it("stores nothing that identifies a household", async () => {
    // the table is shared across the entire user base, so anything household-shaped
    // in here would be a cross-tenant leak
    const { data } = await admin
      .from("import_cache")
      .select("extracted_json")
      .eq("url_hash", urlHash)
      .single();
    const asText = JSON.stringify(data?.extracted_json);
    expect(asText).not.toMatch(/family|account|member|rating/i);
  });

  it("is unreachable by a client, cached or not", async () => {
    const { data, error } = await anon.from("import_cache").select("url_hash");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("treats a row of the wrong shape as a miss rather than serving it", async () => {
    // written by an older version of this package; re-fetching beats surfacing an
    // undefined field deep in the review screen
    const staleHash = `${urlHash}-stale`;
    await admin
      .from("import_cache")
      .upsert({ url_hash: staleHash, extracted_json: { legacy: true } });
    try {
      const cache = createSupabaseImportCache(admin);
      expect(await cache.get(staleHash)).toBeNull();
    } finally {
      await admin.from("import_cache").delete().eq("url_hash", staleHash);
    }
  });
});

describe.skipIf(instance !== null)("supabase import cache (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
