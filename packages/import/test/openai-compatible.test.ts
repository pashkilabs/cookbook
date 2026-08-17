import { describe, expect, it } from "vitest";
import { cascadeFromEnv, createOpenAiCompatibleProvider, providerFromEnv } from "../src/openai-compatible.js";
import { RECIPE_JSON_SCHEMA } from "../src/provider.js";
import type { ModelConfig } from "../src/provider.js";

const MODEL: ModelConfig = { provider: "openai", model: "test-model", region: "us", temperature: 0 };

const respond = (body: unknown, status = 200): typeof globalThis.fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch;

const payload = {
  choices: [{ message: { content: JSON.stringify({ title: "Pie", servings: 4, totalMinutes: 30, ingredientLines: [{ text: "1 cup flour", section: null }], steps: ["Mix."] }) } }],
  usage: { prompt_tokens: 1000, completion_tokens: 200 },
};

describe("the model behind one interface", () => {
  it("asks for the schema strictly, so the shape is the provider's problem", async () => {
    let sent: any;
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://example.test/v1", apiKey: "k",
      fetch: (async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify(payload), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });
    await provider.extract({ model: MODEL, content: "x", instructions: "y", responseSchema: RECIPE_JSON_SCHEMA });
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.temperature).toBe(0);
    expect(sent.model).toBe("test-model");
  });

  it("reports what the call cost, so the eval can price a fixture", async () => {
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://example.test/v1", apiKey: "k", fetch: respond(payload),
      pricing: { inputPerMillion: 0.2, outputPerMillion: 1.2 },
    });
    const result = await provider.extract({ model: MODEL, content: "x", instructions: "y", responseSchema: RECIPE_JSON_SCHEMA });
    // 1000 in at $0.20/M, 200 out at $1.20/M
    expect(result.usage.costUsd).toBeCloseTo(0.0002 + 0.00024, 8);
  });

  it("throws on a provider failure rather than escalating to a pricier model", async () => {
    /*
     * A 429 is the provider failing, not the model answering badly. Escalating would spend money
     * to solve a queueing problem.
     */
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://example.test/v1", apiKey: "k", fetch: respond({ error: "slow down" }, 429),
    });
    await expect(provider.extract({ model: MODEL, content: "x", instructions: "y", responseSchema: RECIPE_JSON_SCHEMA }))
      .rejects.toThrow(/429/);
  });

  it("sends images as data URLs when a request carries them", async () => {
    let sent: any;
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://example.test/v1", apiKey: "k",
      fetch: (async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify(payload), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });
    await provider.extract({
      model: MODEL, content: "x", instructions: "y", responseSchema: RECIPE_JSON_SCHEMA,
      images: [{ mediaType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) }],
    });
    const parts = sent.messages[1].content;
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe("building it from the environment", () => {
  it("returns null when no key is configured, so the eval skips rather than scores zero", () => {
    /*
     * A model that was never called scoring 0% reads as a model that answered badly. The
     * distinction between "not configured" and "wrong" is the one this repo keeps paying to learn.
     */
    expect(providerFromEnv({})).toBeNull();
    expect(providerFromEnv({ PASHKI_LLM_API_KEY: "k" })).toBeNull();
    expect(providerFromEnv({ PASHKI_LLM_BASE_URL: "https://x/v1" })).toBeNull();
  });

  it("builds one when both are present", () => {
    const provider = providerFromEnv({
      PASHKI_LLM_API_KEY: "k", PASHKI_LLM_BASE_URL: "https://x/v1", PASHKI_LLM_PROVIDER: "together",
    });
    expect(provider?.key).toBe("together");
  });
});

describe("vision wiring refuses rather than 404s", () => {
  const base = {
    PASHKI_LLM_API_KEY: "k",
    PASHKI_LLM_BASE_URL: "https://api.together.xyz/v1",
    PASHKI_LLM_MODEL: "openai/gpt-oss-120b",
  };

  // regression: .env.local paired an sk-ant- key with a Together model id, so every photograph
  // posted `google/gemma-4-31B-it` to api.anthropic.com and learned about it as HTTP 404
  it("refuses an Anthropic key paired with a slashed model id, naming the fault", () => {
    expect(() =>
      cascadeFromEnv({
        ...base,
        PASHKI_LLM_VISION_API_KEY: "sk-ant-api03-xxx",
        PASHKI_LLM_VISION_MODEL: "google/gemma-4-31B-it",
      }),
    ).toThrow(/not an Anthropic model/);
  });

  it("allows a slashed vision id when the key is not Anthropic", () => {
    const cascade = cascadeFromEnv({
      ...base,
      PASHKI_LLM_VISION_API_KEY: "together-key",
      PASHKI_LLM_VISION_MODEL: "google/gemma-4-31B-it",
    });
    expect(cascade?.visionModels?.[0]?.model).toBe("google/gemma-4-31B-it");
  });

  // regression: temperature defaulted to 0, and Claude 5 answers `temperature is deprecated for
  // this model` with HTTP 400 — the fault fires on exactly the upgrade it blocks
  it("sends no temperature for a Claude 5 vision model, and 0 for Haiku 4.5", () => {
    const five = cascadeFromEnv({
      ...base,
      PASHKI_LLM_VISION_API_KEY: "sk-ant-api03-xxx",
      PASHKI_LLM_VISION_MODEL: "claude-sonnet-5",
    });
    expect(five?.visionModels?.[0]).not.toHaveProperty("temperature");

    const four = cascadeFromEnv({
      ...base,
      PASHKI_LLM_VISION_API_KEY: "sk-ant-api03-xxx",
      PASHKI_LLM_VISION_MODEL: "claude-haiku-4-5",
    });
    expect(four?.visionModels?.[0]?.temperature).toBe(0);
  });
});
