import { describe, expect, it } from "vitest";
import { hashUrl, importRecipe, normaliseUrl } from "../src/index.js";
import {
  HTML_PRETENDING_TO_BE_AN_IMAGE,
  PAGE_WITH_IMAGE_REFERENCE,
  PAGE_WITH_MICRODATA,
  PAGE_WITH_NO_RECIPE,
  createFakeCache,
  createFakeFetcher,
  jpegBytes,
  pngBytes,
} from "./fixtures.js";

const PIE = "https://example.com/pie";
const IMAGE = "https://cdn.example.com/pie.jpg";

const pieFetcher = () =>
  createFakeFetcher({ [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } }, { [IMAGE]: { bytes: jpegBytes(1200, 800) } });

describe("tier 0: structured recipe data", () => {
  it("returns a structured recipe and a photo", async () => {
    const result = await importRecipe(PIE, { fetcher: pieFetcher() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tier).toBe("structured-data");
    expect(result.recipe.title).toBe("Apple Pie");
    expect(result.recipe.servings).toBe(8); // "Serves 6-8", upper bound
    expect(result.recipe.totalMinutes).toBe(80); // PT1H20M
    expect(result.recipe.sourceName).toBe("Example Blog");
    expect(result.photo).toMatchObject({ format: "jpeg", width: 1200, height: 800 });
  });

  it("parses the ingredients through core, keeping the awkward shapes", async () => {
    const result = await importRecipe(PIE, { fetcher: pieFetcher() });
    if (!result.ok) throw new Error("expected success");
    expect(result.recipe.ingredients).toMatchObject([
      { amount: 2, unit: "cup", item: "all-purpose flour" },
      { amount: 1.5, unit: "cup", item: "sugar" },
      { amount: 14.5, unit: "oz", item: "sliced apples", note: "drained" },
    ]);
  });

  it("flattens sectioned instructions into ordered steps", async () => {
    const result = await importRecipe(PIE, { fetcher: pieFetcher() });
    if (!result.ok) throw new Error("expected success");
    expect(result.recipe.steps).toEqual(["Rub the butter into the flour.", "Bake for 40 minutes."]);
  });

  it("resolves an image reference into the graph rather than fetching the pointer", async () => {
    const fetcher = pieFetcher();
    const result = await importRecipe(PIE, { fetcher });
    if (!result.ok) throw new Error("expected success");
    // the page said {"@id": "…#primaryimage"}; the real URL came from the node it
    // pointed at, which was defined after the reference
    expect(result.recipe.imageUrl).toBe(IMAGE);
    expect(fetcher.byteCalls).toEqual([IMAGE]);
  });
});

describe("tier 1: microdata and plugin markup", () => {
  it("falls through to it when the page publishes no structured data", async () => {
    const fetcher = createFakeFetcher(
      { "https://plugin.example.com/stew": { html: PAGE_WITH_MICRODATA } },
      { "https://plugin.example.com/images/stew.png": { bytes: pngBytes(800, 600) } },
    );
    const result = await importRecipe("https://plugin.example.com/stew", { fetcher });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tier).toBe("microdata");
    expect(result.recipe.title).toBe("Beef Stew");
    expect(result.recipe.servings).toBe(4);
    expect(result.recipe.totalMinutes).toBe(45);
    expect(result.recipe.ingredients.map((i) => i.item)).toEqual([
      "beef chuck",
      "carrots",
      "red wine",
    ]);
    expect(result.recipe.steps).toEqual(["Brown the beef.", "Simmer for two hours."]);
    // og:image, resolved against the page
    expect(result.photo).toMatchObject({ format: "png", width: 800, height: 600 });
  });
});

describe("the shared cache", () => {
  it("populates on a miss and is hit on a repeat", async () => {
    const cache = createFakeCache();
    const first = createFakeFetcher({ [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } }, { [IMAGE]: { bytes: jpegBytes() } });
    const miss = await importRecipe(PIE, { fetcher: first, cache });
    expect(miss.ok && miss.fromCache).toBe(false);
    expect(cache.puts).toHaveLength(1);
    expect(first.pageCalls).toEqual([PIE]);

    // a second fetcher with no fixtures at all: a cache hit must not touch it
    const second = createFakeFetcher({});
    const hit = await importRecipe(PIE, { fetcher: second, cache });
    expect(hit.ok && hit.fromCache).toBe(true);
    expect(second.pageCalls).toEqual([]);
    if (hit.ok) expect(hit.recipe.title).toBe("Apple Pie");
  });

  it("is keyed by URL hash, not by family — the same page shared four ways is one entry", async () => {
    const cache = createFakeCache();
    const fetcher = createFakeFetcher(
      { [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } },
      { [IMAGE]: { bytes: jpegBytes() } },
    );
    for (const variant of [
      PIE,
      `${PIE}?utm_source=facebook`,
      `${PIE}/`,
      "https://www.example.com/pie#recipe",
    ]) {
      await importRecipe(variant, { fetcher, cache });
    }
    expect(cache.store.size).toBe(1);
    // fetched once, then served from the cache three times
    expect(fetcher.pageCalls).toEqual([PIE]);
  });

  it("reports the key it used, so a caller can record it", async () => {
    const result = await importRecipe(PIE, { fetcher: pieFetcher() });
    const normalised = normaliseUrl(PIE);
    if ("kind" in normalised) throw new Error("bad fixture");
    expect(result.ok && result.urlHash).toBe(hashUrl(normalised.href));
  });

  it("re-parses when asked to refresh, and updates the entry", async () => {
    const cache = createFakeCache();
    const fetcher = createFakeFetcher(
      { [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } },
      { [IMAGE]: { bytes: jpegBytes() } },
    );
    await importRecipe(PIE, { fetcher, cache });
    await importRecipe(PIE, { fetcher, cache, refresh: true });
    expect(fetcher.pageCalls).toHaveLength(2);
    expect(cache.puts).toHaveLength(2);
  });

  it("does not fail an import because the cache write failed", async () => {
    const broken = {
      async get() {
        return null;
      },
      async put() {
        throw new Error("cache is down");
      },
    };
    const result = await importRecipe(PIE, { fetcher: pieFetcher(), cache: broken });
    expect(result.ok).toBe(true);
  });
});

describe("failures are typed and explicable", () => {
  it("rejects platforms that never resolve before making a request", async () => {
    const fetcher = createFakeFetcher({});
    const result = await importRecipe("https://www.instagram.com/p/abc123/", { fetcher });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      kind: "blocked-platform",
      platform: "Instagram",
      useInstead: "screenshot",
    });
    // no request was attempted
    expect(fetcher.pageCalls).toEqual([]);
  });

  it("routes TikTok to video rather than screenshots", async () => {
    const result = await importRecipe("https://vm.tiktok.com/xyz/", {
      fetcher: createFakeFetcher({}),
    });
    if (result.ok) throw new Error("expected failure");
    expect(result.failure).toMatchObject({ kind: "blocked-platform", useInstead: "video" });
  });

  it("names an invalid URL as such", async () => {
    const result = await importRecipe("not a url", { fetcher: createFakeFetcher({}) });
    if (result.ok) throw new Error("expected failure");
    expect(result.failure.kind).toBe("invalid-url");
  });

  it("reports a fetch failure with its reason instead of throwing", async () => {
    const fetcher = {
      async page(): Promise<never> {
        throw new Error("HTTP 403 for https://example.com/pie");
      },
      async bytes(): Promise<never> {
        throw new Error("unused");
      },
    };
    const result = await importRecipe(PIE, { fetcher });
    if (result.ok) throw new Error("expected failure");
    expect(result.failure).toMatchObject({ kind: "fetch-failed" });
    expect(result.failure.kind === "fetch-failed" && result.failure.detail).toContain("403");
  });

  it("refuses a response that is not a web page", async () => {
    const fetcher = createFakeFetcher({
      [PIE]: { html: "{}", contentType: "application/json" },
    });
    const result = await importRecipe(PIE, { fetcher });
    if (result.ok) throw new Error("expected failure");
    expect(result.failure.kind).toBe("not-html");
  });

  it("says which tiers it tried when a page carries no recipe", async () => {
    const fetcher = createFakeFetcher({ [PIE]: { html: PAGE_WITH_NO_RECIPE } });
    const result = await importRecipe(PIE, { fetcher });
    if (result.ok) throw new Error("expected failure");
    expect(result.failure).toMatchObject({
      kind: "no-recipe-found",
      triedTiers: ["structured-data", "microdata"],
    });
  });

  it("says what was missing when a tier fired but came up short", async () => {
    // a Recipe node with no ingredients: found, but not usable
    const html = `<script type="application/ld+json">
      {"@type":"Recipe","name":"Empty","recipeInstructions":["Do nothing."]}
    </script>`;
    const result = await importRecipe(PIE, { fetcher: createFakeFetcher({ [PIE]: { html } }) });
    if (result.ok) throw new Error("expected failure");
    expect(result.failure).toMatchObject({
      kind: "recipe-incomplete",
      tier: "structured-data",
      missing: ["ingredients"],
    });
  });

  it("never throws for any of them", async () => {
    const cases: Array<[string, Parameters<typeof importRecipe>[1]]> = [
      ["", { fetcher: createFakeFetcher({}) }],
      ["https://www.facebook.com/x", { fetcher: createFakeFetcher({}) }],
      [PIE, { fetcher: createFakeFetcher({ [PIE]: { html: PAGE_WITH_NO_RECIPE } }) }],
    ];
    for (const [url, options] of cases) {
      await expect(importRecipe(url, options), url).resolves.toBeDefined();
    }
  });
});

describe("a bad image is not a failed import", () => {
  it("returns the recipe with no photo when the image will not decode", async () => {
    const fetcher = createFakeFetcher(
      { [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } },
      { [IMAGE]: { bytes: HTML_PRETENDING_TO_BE_AN_IMAGE, contentType: "image/jpeg" } },
    );
    const result = await importRecipe(PIE, { fetcher });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.photo).toBeNull();
    expect(result.recipe.title).toBe("Apple Pie");
  });

  it("returns the recipe with no photo when the image 404s", async () => {
    const fetcher = createFakeFetcher({ [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } }, {});
    const result = await importRecipe(PIE, { fetcher });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.photo).toBeNull();
  });

  it("skips the image entirely when asked", async () => {
    const fetcher = pieFetcher();
    const result = await importRecipe(PIE, { fetcher, skipPhoto: true });
    expect(result.ok).toBe(true);
    expect(fetcher.byteCalls).toEqual([]);
  });
});
