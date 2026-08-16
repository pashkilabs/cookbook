import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_CASCADE,
  RECIPE_JSON_SCHEMA,
  createImportExtractor,
  extractWithLlm,
  importRecipe,
  pageToText,
  validateRecipePayload,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "../src/index.js";
import {
  PAGE_WITH_IMAGE_REFERENCE,
  PAGE_WITH_NO_RECIPE,
  createFakeCache,
  createFakeFetcher,
  jpegBytes,
} from "./fixtures.js";

import type { ExtractedRecipe, ExtractorOutput } from "@pashki/core/eval";
import { isRefusal } from "@pashki/core/eval";
import { createImportExtractor } from "../src/eval-extractor.js";

/**
 * An extractor may now decline (decisions §46), so its output is a union. These tests are about
 * what it extracts, not about refusing — this narrows and fails loudly if it ever refuses.
 */
function asRecipe(output: ExtractorOutput | null): ExtractedRecipe {
  expect(output).not.toBeNull();
  if (output === null || isRefusal(output)) {
    throw new Error(`expected a recipe, got ${output === null ? "a skip" : "a refusal"}`);
  }
  return output;
}

/** A provider that returns a scripted response per call, recording what it was asked. */
function stubProvider(
  responses: Array<unknown | Error>,
): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let call = 0;
  return {
    key: "stub",
    requests,
    async extract(request: LlmRequest): Promise<LlmResponse> {
      requests.push(request);
      const scripted = responses[call++];
      if (scripted instanceof Error) throw scripted;
      return {
        json: scripted,
        usage: { model: request.model.model, inputTokens: 100, outputTokens: 50, costUsd: 0.0002 },
      };
    },
  };
}

const goodPayload = {
  title: "Caption Carbonara",
  servings: 4,
  totalMinutes: 25,
  ingredientLines: [
    { text: "1 lb spaghetti", section: null },
    { text: "4 egg yolks", section: null },
    { text: "100 g pecorino", section: null },
  ],
  steps: ["Boil the pasta.", "Toss off the heat."],
};

const cascade = (provider: LlmProvider, models = PLACEHOLDER_CASCADE) => ({ provider, models });

describe("schema validation decides escalation", () => {
  it("accepts a well-formed payload", () => {
    const result = validateRecipePayload(goodPayload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ingredientLines).toHaveLength(3);
  });

  it("rejects output that is close but wrong, with reasons", () => {
    const cases: Array<[unknown, RegExp]> = [
      ["a string", /not an object/],
      [{ ...goodPayload, title: 42 }, /title is not a string/],
      [{ ...goodPayload, title: "  " }, /title is empty/],
      [{ ...goodPayload, servings: "four" }, /servings is not a number/],
      [{ ...goodPayload, servings: -1 }, /servings is not positive/],
      [{ ...goodPayload, ingredientLines: "1 lb spaghetti" }, /not an array/],
      [{ ...goodPayload, ingredientLines: [1, 2] }, /not \{ text, section \}/],
      [{ ...goodPayload, ingredientLines: ["1 lb spaghetti"] }, /not \{ text, section \}/],
      [{ ...goodPayload, ingredientLines: [] }, /empty/],
      [{ ...goodPayload, steps: {} }, /steps is not an array/],
    ];
    for (const [value, pattern] of cases) {
      const result = validateRecipePayload(value);
      expect(result.ok, JSON.stringify(value).slice(0, 40)).toBe(false);
      if (!result.ok) expect(result.errors.join("; ")).toMatch(pattern);
    }
  });

  it("treats a missing optional as null rather than an error", () => {
    const result = validateRecipePayload({ ...goodPayload, servings: null, totalMinutes: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.servings).toBeNull();
  });
});

describe("the cascade", () => {
  it("asks for enforced JSON against the schema, not politely in a prompt", async () => {
    const provider = stubProvider([goodPayload]);
    await extractWithLlm({
      content: "some caption text",
      sourceUrl: "https://example.com/x",
      sourceName: "Example",
      cascade: cascade(provider),
    });
    const request = provider.requests[0]!;
    expect(request.responseSchema).toBe(RECIPE_JSON_SCHEMA);
    // the instructions must not be where the JSON requirement lives
    expect(request.instructions).not.toMatch(/\bJSON\b.*\bonly\b/i);
  });

  it("parses ingredient lines through core, not through the model", async () => {
    const provider = stubProvider([
      { ...goodPayload, ingredientLines: [
        { text: "1 (14.5 ounce) can diced tomatoes, drained", section: null },
        { text: "2 T butter", section: null },
      ] },
    ]);
    const result = await extractWithLlm({
      content: "text",
      sourceUrl: "https://example.com/x",
      sourceName: null,
      cascade: cascade(provider),
    });
    // core's parser, with everything it already knows: sized tins and T vs t
    expect(result.recipe?.ingredients).toMatchObject([
      { amount: 14.5, unit: "oz", item: "diced tomatoes", note: "drained" },
      { amount: 2, unit: "tbsp", item: "butter" },
    ]);
  });

  it("uses the first model and does not escalate when it validates", async () => {
    const provider = stubProvider([goodPayload, goodPayload]);
    const result = await extractWithLlm({
      content: "text",
      sourceUrl: "https://example.com/x",
      sourceName: null,
      cascade: cascade(provider),
    });
    expect(provider.requests).toHaveLength(1);
    expect(result.attempts).toEqual([
      { tier: "llm", outcome: "hit", model: PLACEHOLDER_CASCADE[0]!.model },
    ]);
  });

  it("escalates on schema-validation failure and records why", async () => {
    const provider = stubProvider([{ title: "Broken", ingredientLines: [] }, goodPayload]);
    const result = await extractWithLlm({
      content: "text",
      sourceUrl: "https://example.com/x",
      sourceName: null,
      cascade: cascade(provider),
    });
    expect(provider.requests).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ outcome: "invalid-output" });
    expect(result.attempts[0]?.detail).toMatch(/empty/);
    expect(result.attempts[1]).toMatchObject({ outcome: "hit" });
    expect(result.recipe?.title).toBe("Caption Carbonara");
  });

  it("escalates past a provider failure too", async () => {
    const provider = stubProvider([new Error("502 from upstream"), goodPayload]);
    const result = await extractWithLlm({
      content: "text",
      sourceUrl: "https://example.com/x",
      sourceName: null,
      cascade: cascade(provider),
    });
    expect(result.attempts[0]).toMatchObject({ outcome: "provider-error" });
    expect(result.attempts[0]?.detail).toMatch(/502/);
    expect(result.recipe).not.toBeNull();
  });

  it("gives up when every model fails, without throwing", async () => {
    const provider = stubProvider([{ bad: true }, { alsoBad: true }]);
    const result = await extractWithLlm({
      content: "text",
      sourceUrl: "https://example.com/x",
      sourceName: null,
      cascade: cascade(provider),
    });
    expect(result.recipe).toBeNull();
    expect(result.attempts.map((a) => a.outcome)).toEqual(["invalid-output", "invalid-output"]);
  });

  it("does not call a model when there is nothing to read", async () => {
    const provider = stubProvider([goodPayload]);
    const result = await extractWithLlm({
      content: "   ",
      sourceUrl: "https://example.com/x",
      sourceName: null,
      cascade: cascade(provider),
    });
    expect(provider.requests).toEqual([]);
    expect(result.attempts).toEqual([{ tier: "llm", outcome: "no-data", detail: "nothing to read" }]);
  });

  it("never asks a model for an image URL", async () => {
    const provider = stubProvider([goodPayload]);
    const result = await extractWithLlm({
      content: "text",
      sourceUrl: "https://example.com/x",
      sourceName: null,
      cascade: cascade(provider),
    });
    // a plausible-looking invented image would be worse than none
    expect(result.recipe?.imageUrl).toBeNull();
    expect(JSON.stringify(RECIPE_JSON_SCHEMA)).not.toMatch(/image/i);
  });

  it("reports usage per call, so cost can be summed", async () => {
    const provider = stubProvider([{ bad: true }, goodPayload]);
    const result = await extractWithLlm({
      content: "text",
      sourceUrl: "https://example.com/x",
      sourceName: null,
      cascade: cascade(provider),
    });
    expect(result.usage).toHaveLength(2);
    expect(result.usage.map((u) => u.model)).toEqual(PLACEHOLDER_CASCADE.map((m) => m.model));
  });

  it("sends recipe content only — no household data can reach it", async () => {
    const provider = stubProvider([goodPayload]);
    await extractWithLlm({
      content: "1 lb spaghetti\n4 egg yolks",
      sourceUrl: "https://example.com/x",
      sourceName: "Example",
      cascade: cascade(provider),
    });
    const request = provider.requests[0]!;
    // the only inputs are page text and instructions; there is no parameter through
    // which a name, email or rating could arrive
    expect(Object.keys(request).sort()).toEqual([
      "content",
      "instructions",
      "model",
      "responseSchema",
    ]);
    expect(request.content).toBe("1 lb spaghetti\n4 egg yolks");
  });
});

describe("page text for a model", () => {
  it("drops scripts, styles and navigation before truncating", () => {
    const html = `<html><head><style>.a{color:red}</style>
      <script>var junk = "ingredients"</script></head>
      <body><nav>Home About</nav><h1>Pie</h1><li>2 cups flour</li></body></html>`;
    const text = pageToText(html);
    expect(text).toContain("Pie");
    expect(text).toContain("2 cups flour");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("var junk");
    expect(text).not.toContain("Home About");
  });

  it("keeps block boundaries, so a list does not become one line", () => {
    expect(pageToText("<ul><li>a</li><li>b</li></ul>")).toBe("a\nb");
  });
});

describe("tier 2 in the pipeline", () => {
  const PIE = "https://example.com/pie";
  const NOTHING = "https://example.com/about";

  it("is not reached when a deterministic tier answers", async () => {
    const provider = stubProvider([goodPayload]);
    const result = await importRecipe(PIE, {
      fetcher: createFakeFetcher(
        { [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } },
        { "https://cdn.example.com/pie.jpg": { bytes: jpegBytes() } },
      ),
      llm: cascade(provider),
    });
    expect(result.ok && result.tier).toBe("structured-data");
    // deterministic before AI is the control flow, not a preference
    expect(provider.requests).toEqual([]);
  });

  it("answers when the deterministic tiers find nothing", async () => {
    const provider = stubProvider([goodPayload]);
    const result = await importRecipe(NOTHING, {
      fetcher: createFakeFetcher({ [NOTHING]: { html: PAGE_WITH_NO_RECIPE } }),
      llm: cascade(provider),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tier).toBe("llm");
    expect(result.recipe.title).toBe("Caption Carbonara");
    expect(provider.requests).toHaveLength(1);
  });

  it("records every tier it tried, in order", async () => {
    // shape-valid but useless output is the realistic escalation case
    const provider = stubProvider([{ ...goodPayload, ingredientLines: [] }, goodPayload]);
    const result = await importRecipe(NOTHING, {
      fetcher: createFakeFetcher({ [NOTHING]: { html: PAGE_WITH_NO_RECIPE } }),
      llm: cascade(provider),
    });
    if (!result.ok) throw new Error("expected success");
    expect(result.attempts).toEqual([
      { tier: "structured-data", outcome: "no-data" },
      { tier: "microdata", outcome: "no-data" },
      {
        tier: "llm",
        outcome: "invalid-output",
        model: PLACEHOLDER_CASCADE[0]!.model,
        detail: expect.stringContaining("empty"),
      },
      { tier: "llm", outcome: "hit", model: PLACEHOLDER_CASCADE[1]!.model },
    ]);
  });

  it("calls no model at all when no cascade is configured", async () => {
    const result = await importRecipe(NOTHING, {
      fetcher: createFakeFetcher({ [NOTHING]: { html: PAGE_WITH_NO_RECIPE } }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("no-recipe-found");
  });

  it("caches a tier-2 result and reports the right tier on a hit", async () => {
    const cache = createFakeCache();
    const provider = stubProvider([goodPayload]);
    const fetcher = createFakeFetcher({ [NOTHING]: { html: PAGE_WITH_NO_RECIPE } });

    const miss = await importRecipe(NOTHING, { fetcher, cache, llm: cascade(provider) });
    expect(miss.ok && miss.tier).toBe("llm");

    // a hit must not claim tier 0, or the hit rate that decides model spend is wrong
    const hit = await importRecipe(NOTHING, { fetcher: createFakeFetcher({}), cache });
    expect(hit.ok && hit.tier).toBe("llm");
    expect(hit.ok && hit.fromCache).toBe(true);
    expect(provider.requests).toHaveLength(1);
  });

  it("takes the image from the page even when the model wrote the text", async () => {
    // a page whose markup has an image but no readable recipe
    const html = `<html><head><meta property="og:image" content="https://cdn.example.com/pie.jpg">
      <script type="application/ld+json">{"@type":"Recipe","name":"Half a recipe"}</script>
      </head><body><li class="wprm-recipe-ingredient">1 cup something</li></body></html>`;
    const provider = stubProvider([goodPayload]);
    const result = await importRecipe(NOTHING, {
      fetcher: createFakeFetcher(
        { [NOTHING]: { html } },
        { "https://cdn.example.com/pie.jpg": { bytes: jpegBytes() } },
      ),
      llm: cascade(provider),
    });
    if (!result.ok) throw new Error("expected success");
    expect(result.photo).not.toBeNull();
  });
});

describe("as an eval extractor", () => {
  const PIE = "https://example.com/pie";

  it("drives the whole cascade for a url fixture", async () => {
    const extractor = createImportExtractor({
      fetcher: createFakeFetcher(
        { [PIE]: { html: PAGE_WITH_IMAGE_REFERENCE } },
        { "https://cdn.example.com/pie.jpg": { bytes: jpegBytes() } },
      ),
      skipPhoto: true,
    });
    const extracted = asRecipe(await extractor({ kind: "url", url: PIE }));
    expect(extracted).toMatchObject({ title: "Apple Pie", servings: 8, totalMinutes: 80 });
    expect(extracted.ingredients).toHaveLength(3);
  });

  it("sends a caption straight to tier 2, which is the path it exists for", async () => {
    const provider = stubProvider([goodPayload]);
    const extractor = createImportExtractor({
      fetcher: createFakeFetcher({}),
      llm: cascade(provider),
      reportUsage: true,
    });
    const extracted = await extractor({ kind: "caption", text: "1 lb spaghetti\n4 egg yolks" });
    expect(extracted).toMatchObject({ title: "Caption Carbonara", servings: 4 });
    expect(extracted?.usage).toMatchObject({ model: PLACEHOLDER_CASCADE[0]!.model });
  });

  it("skips a screenshot rather than scoring zero on tier 3 it never claimed", async () => {
    const extractor = createImportExtractor({ fetcher: createFakeFetcher({}) });
    expect(await extractor({ kind: "screenshot", imagePath: "x.png" })).toBeNull();
  });

  it("returns null for a caption when no cascade is configured", async () => {
    const extractor = createImportExtractor({ fetcher: createFakeFetcher({}) });
    expect(await extractor({ kind: "caption", text: "1 lb spaghetti" })).toBeNull();
  });
});

describe("a source that names no dish", () => {
  it("accepts a null title rather than escalating for it", async () => {
    // regression: the schema allowed null and the validator still demanded a string, so every
    // untitled caption escalated and then failed — a fault in the harness read as a bad model
    const provider = stubProvider([{ ...goodPayload, title: null }]);
    const result = await extractWithLlm({
      content: "here are the toast details", sourceUrl: "", sourceName: null, cascade: cascade(provider),
    });
    expect(result.recipe?.title).toBeNull();
  });

  it("still treats an empty string as a field the model failed to fill", async () => {
    const provider = stubProvider([{ ...goodPayload, title: "  " }, goodPayload]);
    const result = await extractWithLlm({
      content: "x", sourceUrl: "", sourceName: null, cascade: cascade(provider),
    });
    expect(result.attempts[0]?.outcome).toBe("invalid-output");
  });
});

describe("what the extractor says when there is no recipe", () => {
  /**
   * A refusal is an answer; null is "not my kind of input". Conflating them left confabulation
   * unmeasured on exactly the path most likely to do it — a reel that shows a dish and withholds
   * the recipe (decisions §46).
   */
  it("refuses a page it read and found no recipe in", async () => {
    const extractor = createImportExtractor({
      fetcher: createFakeFetcher({ "https://x.test/none": PAGE_WITH_NO_RECIPE }),
      cache: createFakeCache(),
      skipPhoto: true,
    });
    const out = await extractor({ kind: "url", url: "https://x.test/none", text: PAGE_WITH_NO_RECIPE });
    expect(out && "refused" in out && out.refused.because).toBe("not-a-recipe-page");
  });

  it("refuses a platform that never resolves, rather than reporting nothing", async () => {
    const extractor = createImportExtractor({
      fetcher: createFakeFetcher({}), cache: createFakeCache(), skipPhoto: true,
    });
    const out = await extractor({ kind: "url", url: "https://www.instagram.com/p/C-Xy1z3M-AB/" });
    expect(out && "refused" in out && out.refused.because).toBe("unresolvable-source");
  });

  it("still returns null when it could not look at all", async () => {
    /*
     * A page that would not fetch is not an answer about the page. Reporting it as a refusal
     * would score the network as if it were a judgement.
     */
    const extractor = createImportExtractor({
      fetcher: {
        async page() { throw new Error("offline"); },
        async bytes() { throw new Error("offline"); },
      },
      cache: createFakeCache(), skipPhoto: true,
    });
    const out = await extractor({ kind: "url", url: "https://x.test/unreachable" });
    expect(out).toBeNull();
  });
});
