import { describe, expect, it } from "vitest";
import { cascadeFromEnv, textWiringFault } from "../src/index.js";

/**
 * The text tier's construction guard — the twin vision had and text did not.
 *
 * Each case is a certain fault rather than a heuristic: a credential or an id the
 * OpenAI-compatible protocol cannot carry. The third is this repo's own regression.
 */
describe("the text tier refuses a dialect it cannot speak", () => {
  it("names an Anthropic key on the Chat Completions path", () => {
    const fault = textWiringFault("sk-ant-api03-xxx", "openai/gpt-oss-120b", "https://api.together.xyz/v1");
    expect(fault).toContain("Anthropic key");
    expect(fault).toContain("PASHKI_LLM_API_KEY");
  });

  it("names a base URL pointing at Anthropic, which does not serve /chat/completions", () => {
    const fault = textWiringFault("tgp_v1_xxx", "openai/gpt-oss-120b", "https://api.anthropic.com/v1");
    expect(fault).toContain("api.anthropic.com");
    expect(fault).toContain("/v1/messages");
  });

  // regression: production sent claude-haiku-4-5 to Together's Chat Completions endpoint and got
  // nothing back, while the same card read perfectly through the eval. A model swap has two sites
  // and this is the configuration one.
  it("names an Anthropic model id on an OpenAI-compatible endpoint", () => {
    const fault = textWiringFault("tgp_v1_xxx", "claude-haiku-4-5", "https://api.together.xyz/v1");
    expect(fault).toContain("claude-haiku-4-5");
    expect(fault).toContain("returns nothing, quietly");
  });

  it("passes the wiring that is actually deployed", () => {
    expect(textWiringFault("tgp_v1_xxx", "openai/gpt-oss-120b", "https://api.together.xyz/v1")).toBeNull();
  });

  it("passes a non-Together OpenAI-compatible provider, since a slashless id is not a fault", () => {
    // Groq and OpenAI both use slashless ids; only a claude- prefix is certain
    expect(textWiringFault("gsk_xxx", "llama-3.1-8b-instant", "https://api.groq.com/openai/v1")).toBeNull();
  });
});

describe("the builder refuses at construction rather than at import time", () => {
  const working = {
    PASHKI_LLM_BASE_URL: "https://api.together.xyz/v1",
    PASHKI_LLM_API_KEY: "tgp_v1_xxx",
    PASHKI_LLM_MODEL: "openai/gpt-oss-120b",
  };

  it("builds the deployed configuration", () => {
    expect(cascadeFromEnv(working)).not.toBeNull();
  });

  it("throws on a misconfigured text tier instead of extracting nothing", () => {
    expect(() => cascadeFromEnv({ ...working, PASHKI_LLM_MODEL: "claude-haiku-4-5" })).toThrow(
      /Anthropic id/,
    );
  });

  /*
   * Unconfigured and misconfigured are different answers. An absent key degrades to the
   * deterministic tier, which is the documented behaviour; only a *contradictory* configuration
   * is a deployment fault worth throwing over.
   */
  it("still degrades rather than throwing when text is simply absent", () => {
    expect(cascadeFromEnv({ PASHKI_LLM_MODEL: "openai/gpt-oss-120b" })).toBeNull();
  });
});
