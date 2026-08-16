import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_LIMITS,
  PLACEHOLDER_VISION_CASCADE,
  VISION_JSON_SCHEMA,
  createImportExtractor,
  createPassthroughImagePreparer,
  extractFromImages,
  importFromImages,
  validateVisionPayload,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type PreparedImage,
  type SourceImage,
} from "../src/index.js";
import { HTML_PRETENDING_TO_BE_AN_IMAGE, gifBytes, jpegBytes, pngBytes } from "./fixtures.js";

import type { ExtractedRecipe, ExtractorOutput } from "@pashki/core/eval";
import { isRefusal } from "@pashki/core/eval";

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

function stubVisionProvider(
  responses: Array<unknown | Error>,
): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let call = 0;
  return {
    key: "stub-vision",
    requests,
    async extract(request: LlmRequest): Promise<LlmResponse> {
      requests.push(request);
      const scripted = responses[call++];
      if (scripted instanceof Error) throw scripted;
      return {
        json: scripted,
        usage: { model: request.model.model, inputTokens: 900, outputTokens: 120, costUsd: 0.0011 },
      };
    },
  };
}

const cascade = (provider: LlmProvider) => ({
  provider,
  models: [],
  visionModels: PLACEHOLDER_VISION_CASCADE,
});

/** A reel: the on-screen card, the caption, then a plated shot. */
const threeFrames = (): SourceImage[] => [
  { bytes: jpegBytes(800, 1400), label: "card.jpg" },
  { bytes: pngBytes(700, 300), label: "caption.png" },
  { bytes: jpegBytes(900, 900), label: "plated.jpg" },
];

const prepared = async (images = threeFrames()): Promise<PreparedImage[]> =>
  (await createPassthroughImagePreparer().prepare(images)).images;

/** Fused across all three frames, with two amounts the reel never stated. */
const fusedPayload = {
  title: "Reel Birria Tacos",
  servings: 4,
  totalMinutes: 180,
  ingredientLines: [
    { text: "3 lbs beef chuck", amountEstimated: false },
    { text: "4 dried guajillo chiles", amountEstimated: false },
    { text: "1 splash of vinegar", amountEstimated: true },
    { text: "2 cups beef broth", amountEstimated: true },
  ],
  steps: ["Toast the chiles.", "Braise for three hours.", "Fry the tacos."],
  dishImageIndex: 2,
};

describe("preparing screenshots", () => {
  it("decodes rather than trusting, and reports the real dimensions", async () => {
    const result = await createPassthroughImagePreparer().prepare(threeFrames());
    expect(result.rejected).toEqual([]);
    expect(result.images.map((i) => [i.width, i.height])).toEqual([
      [800, 1400],
      [700, 300],
      [900, 900],
    ]);
    expect(result.images.map((i) => i.mediaType)).toEqual([
      "image/jpeg",
      "image/png",
      "image/jpeg",
    ]);
  });

  it("rejects with a reason rather than dropping silently", async () => {
    const result = await createPassthroughImagePreparer().prepare([
      { bytes: HTML_PRETENDING_TO_BE_AN_IMAGE, label: "error-page.jpg" },
      { bytes: jpegBytes(4000, 3000), label: "full-size.jpg" },
      { bytes: gifBytes(64, 64), label: "spacer.gif" },
      { bytes: jpegBytes(100, 100), label: "fine.jpg" },
    ]);
    expect(result.images.map((i) => i.label)).toEqual(["fine.jpg"]);
    expect(result.rejected).toEqual([
      { image: "error-page.jpg", detail: "not a decodable image" },
      {
        image: "full-size.jpg",
        detail: expect.stringContaining(`exceeds ${DEFAULT_IMAGE_LIMITS.maxDimension}px`),
      },
      { image: "spacer.gif", detail: "gif is not supported for vision" },
    ]);
  });
});

describe("the vision schema", () => {
  it("asks for the estimate flag per ingredient, not as a note", () => {
    const items = (VISION_JSON_SCHEMA.properties as Record<string, { items?: unknown }>)
      .ingredientLines?.items as { required?: string[] };
    expect(items?.required).toEqual(["text", "section", "amountEstimated"]);
  });

  it("asks which supplied image shows the dish, by index", () => {
    expect(VISION_JSON_SCHEMA.properties).toHaveProperty("dishImageIndex");
    // an index into images the user gave us, never a URL for the model to invent
    expect(JSON.stringify(VISION_JSON_SCHEMA)).not.toMatch(/\burl\b/i);
  });
});

describe("validating vision output", () => {
  it("accepts a fused payload", () => {
    const result = validateVisionPayload(fusedPayload, 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ingredientLines).toHaveLength(4);
  });

  it("rejects output that is close but wrong", () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ ...fusedPayload, title: "" }, /title is empty/],
      [{ ...fusedPayload, ingredientLines: [] }, /empty/],
      [{ ...fusedPayload, ingredientLines: ["1 lb beef"] }, /is not an object/],
      [{ ...fusedPayload, ingredientLines: [{ amountEstimated: true }] }, /text is missing/],
      [
        { ...fusedPayload, ingredientLines: [{ text: "x", amountEstimated: "yes" }] },
        /amountEstimated is not a boolean/,
      ],
      [{ ...fusedPayload, steps: "Toast the chiles" }, /steps is not an array/],
    ];
    for (const [value, pattern] of cases) {
      const result = validateVisionPayload(value, 3);
      expect(result.ok, JSON.stringify(value).slice(0, 40)).toBe(false);
      if (!result.ok) expect(result.errors.join("; ")).toMatch(pattern);
    }
  });

  it("treats a missing estimate flag as not estimated rather than failing", () => {
    // the most likely thing a weaker vision model drops; escalating the whole
    // extraction over it would waste the good part
    const result = validateVisionPayload(
      { ...fusedPayload, ingredientLines: [{ text: "3 lbs beef chuck" }] },
      3,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ingredientLines[0]?.amountEstimated).toBe(false);
  });

  it("discards an image index that does not exist rather than picking a wrong photo", () => {
    for (const index of [7, -1, 1.5, "2", null]) {
      const result = validateVisionPayload({ ...fusedPayload, dishImageIndex: index }, 3);
      expect(result.ok, String(index)).toBe(true);
      if (result.ok) expect(result.value.dishImageIndex, String(index)).toBeNull();
    }
  });
});

describe("multi-image fusion", () => {
  it("sends every frame in one call, not one call per frame", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    await extractFromImages({ images: await prepared(), cascade: cascade(provider) });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.images).toHaveLength(3);
  });

  it("produces one recipe rather than three partial ones", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.recipe?.title).toBe("Reel Birria Tacos");
    expect(result.recipe?.ingredients).toHaveLength(4);
    expect(result.recipe?.steps).toHaveLength(3);
  });

  it("uses the same provider interface as tier 2 — images are the only difference", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    await extractFromImages({ images: await prepared(), cascade: cascade(provider) });
    const request = provider.requests[0]!;
    expect(Object.keys(request).sort()).toEqual([
      "content",
      "images",
      "instructions",
      "model",
      "responseSchema",
    ]);
    // and the model came from config, not from a branch in code
    expect(request.model).toEqual(PLACEHOLDER_VISION_CASCADE[0]);
  });

  it("carries no text content, so nothing about the household can reach it", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    await extractFromImages({ images: await prepared(), cascade: cascade(provider) });
    expect(provider.requests[0]?.content).toBe("");
  });
});

describe("flagging amounts the model guessed", () => {
  it("marks estimated ingredients and leaves read ones alone", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.recipe?.ingredients.map((i) => [i.item, i.estimated ?? false])).toEqual([
      ["beef chuck", false],
      ["dried guajillo chiles", false],
      ["vinegar", true],
      ["beef broth", true],
    ]);
  });

  it("keeps a flag on the right ingredient when a line will not parse", async () => {
    // parseIngredientList drops what it cannot read, which would shift every
    // following flag by one — a "we guessed this" marker on the wrong row tells
    // somebody a number is trustworthy when it is not
    const provider = stubVisionProvider([
      {
        ...fusedPayload,
        ingredientLines: [
          { text: "123", amountEstimated: false },
          { text: "1 splash of cream", amountEstimated: true },
        ],
      },
    ]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.recipe?.ingredients).toHaveLength(1);
    expect(result.recipe?.ingredients[0]).toMatchObject({
      // "splash of" is now read as the vague quantity it is and moved to the note, so the
      // ingredient is the food. The alignment this test guards is unchanged: the surviving row
      // keeps its own flag rather than inheriting the dropped line's.
      item: "cream",
      estimated: true,
    });
  });

  it("parses through core, so a vision line gets the same treatment as any other", async () => {
    const provider = stubVisionProvider([
      {
        ...fusedPayload,
        ingredientLines: [
          { text: "1 (14.5 oz) can crushed tomatoes", amountEstimated: false },
          { text: "2 T butter", amountEstimated: true },
        ],
      },
    ]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.recipe?.ingredients).toMatchObject([
      { amount: 14.5, unit: "oz", item: "crushed tomatoes" },
      { amount: 2, unit: "tbsp", item: "butter", estimated: true },
    ]);
  });
});

describe("choosing the finished dish", () => {
  it("returns the image the model picked", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.photo).toMatchObject({ imageIndex: 2, label: "plated.jpg", width: 900 });
  });

  it("returns no photo when the model says none of them show it", async () => {
    const provider = stubVisionProvider([{ ...fusedPayload, dishImageIndex: null }]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.photo).toBeNull();
    // and the recipe still has no invented URL
    expect(result.recipe?.imageUrl).toBeNull();
  });

  it("returns no photo rather than a wrong one for an out-of-range index", async () => {
    const provider = stubVisionProvider([{ ...fusedPayload, dishImageIndex: 9 }]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.photo).toBeNull();
  });
});

describe("escalation", () => {
  it("escalates on validation failure and records why", async () => {
    const provider = stubVisionProvider([{ ...fusedPayload, ingredientLines: [] }, fusedPayload]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.attempts.map((a) => [a.tier, a.outcome])).toEqual([
      ["vision", "invalid-output"],
      ["vision", "hit"],
    ]);
    expect(result.attempts[1]?.model).toBe(PLACEHOLDER_VISION_CASCADE[1]?.model);
  });

  it("escalates past a provider failure", async () => {
    const provider = stubVisionProvider([new Error("503 vision upstream"), fusedPayload]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.attempts[0]).toMatchObject({ outcome: "provider-error" });
    expect(result.recipe).not.toBeNull();
  });

  it("gives up without throwing when every vision model fails", async () => {
    const provider = stubVisionProvider([{ bad: true }, { alsoBad: true }]);
    const result = await extractFromImages({
      images: await prepared(),
      cascade: cascade(provider),
    });
    expect(result.recipe).toBeNull();
    expect(result.usage).toHaveLength(2);
  });

  it("refuses rather than calling a text model that cannot see", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    const result = await extractFromImages({
      images: await prepared(),
      // a cascade with text models and no vision models
      cascade: { provider, models: [{ provider: "x", model: "text-only", region: "us" }] },
    });
    expect(provider.requests).toEqual([]);
    expect(result.attempts[0]).toMatchObject({
      outcome: "no-data",
      detail: "no vision model configured",
    });
  });
});

describe("importFromImages", () => {
  it("prepares then extracts, reporting what it could not send", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    const outcome = await importFromImages(
      [...threeFrames(), { bytes: HTML_PRETENDING_TO_BE_AN_IMAGE, label: "broken.jpg" }],
      { cascade: cascade(provider), preparer: createPassthroughImagePreparer() },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tier).toBe("vision");
    expect(outcome.rejected).toEqual([
      { image: "broken.jpg", detail: "not a decodable image" },
    ]);
    expect(provider.requests[0]?.images).toHaveLength(3);
  });

  it("says vision is not configured rather than reporting no recipe", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    const outcome = await importFromImages(threeFrames(), {
      cascade: { provider, models: [] },
      preparer: createPassthroughImagePreparer(),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // the fix is a config change, not a better screenshot
    expect(outcome.failure.kind).toBe("vision-not-configured");
  });

  it("reports no usable images with the reason for each", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    const outcome = await importFromImages(
      [{ bytes: HTML_PRETENDING_TO_BE_AN_IMAGE, label: "a.jpg" }, { bytes: gifBytes(), label: "b.gif" }],
      { cascade: cascade(provider), preparer: createPassthroughImagePreparer() },
    );
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.failure.kind).toBe("no-usable-images");
    if (outcome.failure.kind === "no-usable-images") {
      expect(outcome.failure.rejected).toHaveLength(2);
    }
    expect(provider.requests).toEqual([]);
  });
});

describe("as an eval extractor", () => {
  const images: Record<string, Uint8Array> = {
    "images/card.jpg": jpegBytes(800, 1400),
    "images/caption.png": pngBytes(700, 300),
    "images/plated.jpg": jpegBytes(900, 900),
  };

  const loadImage = async (path: string): Promise<Uint8Array> => {
    const found = images[path];
    if (!found) throw new Error(`no fixture image at ${path}`);
    return found;
  };

  it("fuses every frame a screenshot fixture lists", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    const extractor = createImportExtractor({
      fetcher: { async page() { throw new Error("unused"); }, async bytes() { throw new Error("unused"); } },
      llm: cascade(provider),
      loadImage,
      reportUsage: true,
    });

    const extracted = await extractor({
      kind: "screenshot",
      imagePath: "images/card.jpg",
      extraImagePaths: ["images/caption.png", "images/plated.jpg"],
    });

    const recipe = asRecipe(extracted);
    expect(recipe).toMatchObject({ title: "Reel Birria Tacos", servings: 4, totalMinutes: 180 });
    expect(recipe.ingredients).toHaveLength(4);
    expect(provider.requests[0]?.images).toHaveLength(3);
    expect(recipe.usage).toMatchObject({ model: PLACEHOLDER_VISION_CASCADE[0]!.model });
  });

  it("handles a single-image fixture as the simple case", async () => {
    const provider = stubVisionProvider([{ ...fusedPayload, dishImageIndex: 0 }]);
    const extractor = createImportExtractor({
      fetcher: { async page() { throw new Error("unused"); }, async bytes() { throw new Error("unused"); } },
      llm: cascade(provider),
      loadImage,
    });
    const extracted = await extractor({ kind: "screenshot", imagePath: "images/plated.jpg" });
    expect(asRecipe(extracted).title).toBe("Reel Birria Tacos");
    expect(provider.requests[0]?.images).toHaveLength(1);
  });

  it("skips rather than scoring zero when no vision model is configured", async () => {
    const extractor = createImportExtractor({
      fetcher: { async page() { throw new Error("unused"); }, async bytes() { throw new Error("unused"); } },
      loadImage,
    });
    expect(await extractor({ kind: "screenshot", imagePath: "images/plated.jpg" })).toBeNull();
  });

  it("skips a fixture whose image is missing, rather than blaming the extractor", async () => {
    const provider = stubVisionProvider([fusedPayload]);
    const extractor = createImportExtractor({
      fetcher: { async page() { throw new Error("unused"); }, async bytes() { throw new Error("unused"); } },
      llm: cascade(provider),
      loadImage,
    });
    expect(await extractor({ kind: "screenshot", imagePath: "images/nope.jpg" })).toBeNull();
  });
});
