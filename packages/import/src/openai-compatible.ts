import type { ImageInput, LlmProvider, LlmRequest, LlmResponse } from "./provider.js";

/**
 * One provider, speaking the Chat Completions dialect with strict JSON schema.
 *
 * ---------------------------------------------------------------------------
 * Why this shape rather than a vendor SDK
 * ---------------------------------------------------------------------------
 *
 * Decisions §7 says the model is a config value and the table is "an August 2026 snapshot due
 * for re-benchmarking". A vendor SDK makes that false: it puts the vendor in the import
 * statements, and re-benchmarking becomes a rewrite instead of an environment variable.
 *
 * `POST /chat/completions` with `response_format: { type: "json_schema", strict: true }` is spoken
 * by OpenAI, Together, Groq, Fireworks and Azure OpenAI. So **base URL, model id and key are all
 * configuration**, and changing workhorse is changing `PASHKI_LLM_MODEL`. That is what makes the
 * quarterly re-benchmark §7 asks for actually cheap to run.
 *
 * Anthropic does not speak this dialect — it wants `/v1/messages` and a tool-call for structured
 * output. Escalation to Claude therefore needs a second provider implementing the same interface,
 * which is exactly what the interface is for and is not built here.
 *
 * ---------------------------------------------------------------------------
 * Schema-enforced, and validated anyway
 * ---------------------------------------------------------------------------
 *
 * `strict: true` makes the provider refuse to emit anything the schema forbids, and the response
 * is still put through `validateRecipePayload` upstream. Not belt and braces for its own sake:
 * strict mode guarantees *shape*, not *sense* — an empty ingredient array satisfies the schema and
 * is not a recipe. The cascade escalates on validation failure, never on a low-quality answer,
 * because "bad output" is not a thing a program can detect and the review screen is where a human
 * does (CLAUDE.md).
 *
 * ---------------------------------------------------------------------------
 * Never from a browser
 * ---------------------------------------------------------------------------
 *
 * The key is read from the environment by the caller and passed in. `check-server-only.mjs` fails
 * the build if this module reaches a `"use client"` file or `apps/mobile`.
 */
export interface OpenAiCompatibleOptions {
  /** e.g. `https://api.openai.com/v1`. No trailing slash. */
  baseUrl: string;
  apiKey: string;
  /** names the provider in `ModelConfig.provider` and in the eval's cost report */
  key?: string;
  /** injected so tests need no network and production needs no globals */
  fetch?: typeof globalThis.fetch;
  /** per request, in milliseconds */
  timeoutMs?: number;
  /** $ per million tokens, so the eval can report cost per fixture */
  pricing?: { inputPerMillion: number; outputPerMillion: number };
}

interface ChatMessage {
  role: "system" | "user";
  content: string | Array<Record<string, unknown>>;
}

const imagePart = (image: ImageInput) => ({
  type: "image_url",
  image_url: {
    url: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString("base64")}`,
  },
});

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LlmProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/$/, "");

  return {
    key: options.key ?? "openai-compatible",

    async extract(request: LlmRequest): Promise<LlmResponse> {
      const text: ChatMessage = { role: "user", content: request.content };
      const messages: ChatMessage[] = [
        { role: "system", content: request.instructions },
        request.images?.length
          ? { role: "user", content: [{ type: "text", text: request.content }, ...request.images.map(imagePart)] }
          : text,
      ];

      const response = await doFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model.model,
          temperature: request.model.temperature ?? 0,
          ...(request.model.maxOutputTokens ? { max_tokens: request.model.maxOutputTokens } : {}),
          messages,
          response_format: {
            type: "json_schema",
            json_schema: { name: "recipe", strict: true, schema: request.responseSchema },
          },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        /*
         * Thrown rather than returned as an invalid answer. A 429 or a 500 is the provider
         * failing, not the model answering badly, and escalating to a pricier model because the
         * cheap one was rate-limited would spend money to solve a queueing problem.
         */
        throw new Error(`${request.model.model} responded ${response.status}: ${detail.slice(0, 200)}`);
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`${request.model.model} returned no message content`);
      }

      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        // strict mode should make this impossible; if it happens the model or the gateway is
        // not honouring the contract, and that is worth escalating rather than crashing
        return {
          json: null,
          usage: { model: request.model.model },
        };
      }

      const inputTokens = body.usage?.prompt_tokens;
      const outputTokens = body.usage?.completion_tokens;
      const price = options.pricing;
      const costUsd =
        price && inputTokens !== undefined && outputTokens !== undefined
          ? (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000
          : undefined;

      return {
        json,
        usage: {
          model: request.model.model,
          ...(inputTokens === undefined ? {} : { inputTokens }),
          ...(outputTokens === undefined ? {} : { outputTokens }),
          ...(costUsd === undefined ? {} : { costUsd }),
        },
      };
    },
  };
}

/**
 * Build the provider from the environment, or say why it cannot be built.
 *
 * Returns null rather than throwing so the eval records a **skip** — "tier 2 was not configured"
 * — instead of a zero. A model that was never called scoring 0% would read as a model that
 * answered badly, which is the measurement fault this repo keeps paying for.
 */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): LlmProvider | null {
  const apiKey = env.PASHKI_LLM_API_KEY;
  const baseUrl = env.PASHKI_LLM_BASE_URL;
  if (!apiKey || !baseUrl) return null;

  const inputPerMillion = Number(env.PASHKI_LLM_INPUT_PER_MILLION);
  const outputPerMillion = Number(env.PASHKI_LLM_OUTPUT_PER_MILLION);

  return createOpenAiCompatibleProvider({
    baseUrl,
    apiKey,
    key: env.PASHKI_LLM_PROVIDER ?? "openai-compatible",
    ...(Number.isFinite(inputPerMillion) && Number.isFinite(outputPerMillion)
      ? { pricing: { inputPerMillion, outputPerMillion } }
      : {}),
  });
}
