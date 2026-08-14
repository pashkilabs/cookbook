import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readLocalInstance } from "@pashki/db/test-support";
import { hashUrl, importRecipe, normaliseUrl } from "../src/index.js";
import { createSupabaseImportCache } from "../src/supabase-cache.js";
import { CACHE_MAX_AGE_DAYS, EXTRACTOR_VERSION } from "../src/cache-policy.js";
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
    expect((data?.extracted_json as { tier: string; recipe: { title: string } }).recipe.title).toBe(
      "Apple Pie",
    );
    expect((data?.extracted_json as { tier: string }).tier).toBe("structured-data");
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

  describe("expiry", () => {
    /**
     * Against a real row, because the policy is only worth anything if the two columns it reads
     * are actually written and actually read back. The pure tests in `cache-policy.test.ts`
     * decide *when*; these prove the wiring.
     */
    const withRow = async (
      hash: string,
      overrides: Record<string, unknown>,
      assertion: (cache: ReturnType<typeof createSupabaseImportCache>) => Promise<void>,
    ) => {
      const { error } = await admin.from("import_cache").upsert({
        url_hash: hash,
        extracted_json: {
          tier: "structured-data",
          recipe: { title: "Cached Pie", ingredients: [], steps: [], sourceUrl: "https://example.com/pie" },
        },
        fetched_at: new Date().toISOString(),
        extractor_version: EXTRACTOR_VERSION,
        ...overrides,
      });
      if (error) throw error;
      try {
        await assertion(createSupabaseImportCache(admin));
      } finally {
        await admin.from("import_cache").delete().eq("url_hash", hash);
      }
    };

    it("serves a row written by this extractor, recently", async () => {
      // the control: without it, every assertion below could pass on a broken fixture
      await withRow(`${urlHash}-ok`, {}, async (cache) => {
        expect(await cache.get(`${urlHash}-ok`)).toMatchObject({ tier: "structured-data" });
      });
    });

    it("misses a row written by an older extractor, however recent", async () => {
      await withRow(`${urlHash}-oldparser`, { extractor_version: EXTRACTOR_VERSION - 1 }, async (cache) => {
        expect(await cache.get(`${urlHash}-oldparser`)).toBeNull();
      });
    });

    it("misses every row that predates stamping", async () => {
      // the column defaults to 0, so this is the state of everything already in the table
      await withRow(`${urlHash}-unstamped`, { extractor_version: 0 }, async (cache) => {
        expect(await cache.get(`${urlHash}-unstamped`)).toBeNull();
      });
    });

    it("misses a row older than the age, even from this extractor", async () => {
      const old = new Date(Date.now() - (CACHE_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
      await withRow(`${urlHash}-aged`, { fetched_at: old }, async (cache) => {
        expect(await cache.get(`${urlHash}-aged`)).toBeNull();
      });
    });

    it("stamps what it writes, so a future correction can reach it", async () => {
      const hash = `${urlHash}-stamped`;
      const cache = createSupabaseImportCache(admin);
      await cache.put(hash, {
        tier: "structured-data",
        recipe: { title: "Fresh Pie", ingredients: [], steps: [], sourceUrl: "https://example.com/fresh" },
      } as never);
      try {
        const { data } = await admin
          .from("import_cache")
          .select("extractor_version, fetched_at")
          .eq("url_hash", hash)
          .single();
        expect(data?.extractor_version).toBe(EXTRACTOR_VERSION);
        expect(data?.fetched_at).not.toBeNull();
      } finally {
        await admin.from("import_cache").delete().eq("url_hash", hash);
      }
    });

    it("replaces a stale row rather than accumulating a second one", async () => {
      const hash = `${urlHash}-replaced`;
      await withRow(hash, { extractor_version: 0 }, async (cache) => {
        expect(await cache.get(hash), "stale, so a miss").toBeNull();
        await cache.put(hash, {
          tier: "microdata",
          recipe: { title: "Re-extracted", ingredients: [], steps: [], sourceUrl: "https://example.com/pie" },
        } as never);
        expect(await cache.get(hash)).toMatchObject({ tier: "microdata" });

        const { count } = await admin
          .from("import_cache")
          .select("url_hash", { count: "exact", head: true })
          .eq("url_hash", hash);
        expect(count, "url_hash is the primary key; a miss must not fork the row").toBe(1);
      });
    });
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
