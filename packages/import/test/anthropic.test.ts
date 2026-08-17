import { describe, expect, it } from "vitest";
import { createAnthropicProvider, visionProviderFromEnv } from "../src/anthropic.js";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { RECIPE_JSON_SCHEMA } from "../src/provider.js";
import type { ModelConfig } from "../src/provider.js";

const MODEL: ModelConfig = { provider: "anthropic", model: "test-model", region: "us", temperature: 0 };
const req = (images?: any) => ({
  model: MODEL, content: "read this", instructions: "extract it",
  responseSchema: RECIPE_JSON_SCHEMA, ...(images ? { images } : {}),
});
const reply = (body: unknown, status = 200): typeof globalThis.fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch;

const toolCall = {
  content: [{ type: "tool_use", name: "record_recipe", input: { title: "Bars", servings: null, totalMinutes: 20, ingredientLines: [], steps: [] } }],
  usage: { input_tokens: 2000, output_tokens: 400 },
};

describe("structured output as a forced tool call", () => {
  it("declares the schema as a tool and forces the model to call it", async () => {
    let sent: any;
    const provider = createAnthropicProvider({
      apiKey: "k",
      fetch: (async (_u: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify(toolCall), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });
    await provider.extract(req());
    expect(sent.tools[0].input_schema).toEqual(RECIPE_JSON_SCHEMA);
    expect(sent.tool_choice).toEqual({ type: "tool", name: "record_recipe" });
    expect(sent.system).toBe("extract it");
  });

  it("returns the tool's arguments as the JSON", async () => {
    const provider = createAnthropicProvider({ apiKey: "k", fetch: reply(toolCall) });
    const out = await provider.extract(req());
    expect((out.json as { title: string }).title).toBe("Bars");
  });

  it("returns null when the model answered in prose instead of calling the tool", async () => {
    // not honouring tool_choice is a contract failure, and the cascade escalates on it — the
    // same path a schema violation takes on the other provider
    const provider = createAnthropicProvider({
      apiKey: "k",
      fetch: reply({ content: [{ type: "text", text: "I could not read it" }], usage: {} }),
    });
    expect((await provider.extract(req())).json).toBeNull();
  });

  it("puts the image before the instruction, so the words are read in its light", async () => {
    let sent: any;
    const provider = createAnthropicProvider({
      apiKey: "k",
      fetch: (async (_u: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify(toolCall), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });
    await provider.extract(req([{ mediaType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) }]));
    expect(sent.messages[0].content[0].type).toBe("image");
    expect(sent.messages[0].content[0].source.media_type).toBe("image/jpeg");
    expect(sent.messages[0].content[1].type).toBe("text");
  });

  it("prices a call so the eval can report cost per card", async () => {
    const provider = createAnthropicProvider({
      apiKey: "k", fetch: reply(toolCall),
      pricing: { inputPerMillion: 1, outputPerMillion: 5 },
    });
    const out = await provider.extract(req());
    expect(out.usage.costUsd).toBeCloseTo(0.002 + 0.002, 8);
  });

  it("throws on a provider failure rather than escalating to a pricier model", async () => {
    const provider = createAnthropicProvider({ apiKey: "k", fetch: reply({ error: "overloaded" }, 529) });
    await expect(provider.extract(req())).rejects.toThrow(/529/);
  });
});

describe("configuring vision separately from text", () => {
  it("is null without its own key, so the eval skips rather than scores zero", () => {
    expect(visionProviderFromEnv({})).toBeNull();
    // the text key must not switch vision on: they are different questions (§7)
    expect(visionProviderFromEnv({ PASHKI_LLM_API_KEY: "k" })).toBeNull();
  });

  it("builds from its own variables", () => {
    expect(visionProviderFromEnv({ PASHKI_LLM_VISION_API_KEY: "k" })?.key).toBe("anthropic");
  });
});

describe("one builder for the product and the eval", () => {
  it("gives vision its own provider, not the text one", () => {
    /*
     * regression: the eval and the web app each built a cascade, and only the eval knew about
     * the Anthropic vision provider — so production sent an Anthropic model name to Together's
     * Chat Completions endpoint and got nothing. A model swap has one site now.
     */
    const cascade = cascadeFromEnv({
      PASHKI_LLM_BASE_URL: "https://api.together.xyz/v1",
      PASHKI_LLM_API_KEY: "together-key",
      PASHKI_LLM_MODEL: "openai/gpt-oss-120b",
      PASHKI_LLM_VISION_API_KEY: "anthropic-key",
      PASHKI_LLM_VISION_MODEL: "claude-haiku-4-5",
    })!;
    expect(cascade.provider.key).toBe("openai-compatible");
    expect(cascade.visionProvider?.key).toBe("anthropic");
    // and the vision model is attributed to the vision provider, not the text one
    expect(cascade.visionModels?.[0]?.provider).toBe("anthropic");
    expect(cascade.visionModels?.[0]?.model).toBe("claude-haiku-4-5");
  });

  it("leaves vision unconfigured when only text has a key", () => {
    const cascade = cascadeFromEnv({
      PASHKI_LLM_BASE_URL: "https://x/v1", PASHKI_LLM_API_KEY: "k", PASHKI_LLM_MODEL: "m",
    })!;
    expect(cascade.visionModels).toBeUndefined();
    expect(cascade.visionProvider).toBeUndefined();
  });

  it("is null when text is unconfigured, so a deployment is degraded and not broken", () => {
    expect(cascadeFromEnv({})).toBeNull();
  });
});
