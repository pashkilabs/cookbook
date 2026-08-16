import type { ImageInput, LlmProvider, LlmRequest, LlmResponse } from "./provider.js";

/**
 * The second provider, and the reason the interface exists.
 *
 * Anthropic does not speak Chat Completions: it wants `POST /v1/messages`, and it has no
 * `response_format`. Structured output is a **forced tool call** — declare a tool whose
 * `input_schema` is the schema, then set `tool_choice` to that tool, and the model must answer by
 * calling it. The arguments it passes are the JSON.
 *
 * That is a different wire protocol and an identical contract, which is what `LlmProvider` was
 * for. Nothing else changes: the cascade, the validator, the eval and the review screen are
 * untouched, and swapping vision from Together to Anthropic is configuration plus this file.
 *
 * **Vision only, for now.** The text workhorse stays on Together where it is measured at 80.4%
 * and costs $0.0007 a caption — there is no argument for moving something that works, and every
 * model swap in this project has been justified by a measurement rather than a preference.
 */
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicOptions {
  apiKey: string;
  /** defaults to the public API; overridable for a gateway or a regional endpoint */
  baseUrl?: string;
  key?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** $ per million tokens, so the eval can price a card */
  pricing?: { inputPerMillion: number; outputPerMillion: number };
}

const imageBlock = (image: ImageInput) => ({
  type: "image",
  source: {
    type: "base64",
    media_type: image.mediaType,
    data: Buffer.from(image.bytes).toString("base64"),
  },
});

export function createAnthropicProvider(options: AnthropicOptions): LlmProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");

  return {
    key: options.key ?? "anthropic",

    async extract(request: LlmRequest): Promise<LlmResponse> {
      /*
       * Images first, then the text. Anthropic's own guidance, and it matters for a photograph of
       * a recipe card: the instruction is read in the light of the picture rather than the other
       * way round.
       */
      const content = [
        ...(request.images ?? []).map(imageBlock),
        { type: "text", text: request.content },
      ];

      const response = await doFetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: request.model.model,
          max_tokens: request.model.maxOutputTokens ?? 4096,
          temperature: request.model.temperature ?? 0,
          system: request.instructions,
          messages: [{ role: "user", content }],
          // the forced tool call *is* the structured output: the schema is the tool's input
          tools: [
            {
              name: "record_recipe",
              description: "Record the recipe exactly as it appears in the source.",
              input_schema: request.responseSchema,
            },
          ],
          tool_choice: { type: "tool", name: "record_recipe" },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        // a 429 or a 529 is the provider failing, not the model answering badly — escalating
        // would spend money to solve a queueing problem
        throw new Error(`${request.model.model} responded ${response.status}: ${detail.slice(0, 200)}`);
      }

      const body = (await response.json()) as {
        content?: Array<{ type?: string; name?: string; input?: unknown }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      /*
       * The tool call, not the prose. A model that answers in text rather than calling the tool
       * has not honoured `tool_choice`, and returning null here makes the cascade escalate —
       * the same path a schema violation takes on the other provider.
       */
      const call = body.content?.find((block) => block.type === "tool_use");
      const inputTokens = body.usage?.input_tokens;
      const outputTokens = body.usage?.output_tokens;
      const price = options.pricing;
      const costUsd =
        price && inputTokens !== undefined && outputTokens !== undefined
          ? (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000
          : undefined;

      return {
        json: call?.input ?? null,
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
 * The vision provider, built from its own variables.
 *
 * Separate from `PASHKI_LLM_*` on purpose: vision and text are different questions with different
 * answers (§7), and the text path is measured and cheap where it is. Null when unconfigured, so
 * the eval records a skip rather than scoring a model nobody called.
 */
export function visionProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmProvider | null {
  const apiKey = env.PASHKI_LLM_VISION_API_KEY;
  if (!apiKey) return null;

  const inputPerMillion = Number(env.PASHKI_LLM_VISION_INPUT_PER_MILLION);
  const outputPerMillion = Number(env.PASHKI_LLM_VISION_OUTPUT_PER_MILLION);

  return createAnthropicProvider({
    apiKey,
    ...(env.PASHKI_LLM_VISION_BASE_URL ? { baseUrl: env.PASHKI_LLM_VISION_BASE_URL } : {}),
    key: env.PASHKI_LLM_VISION_PROVIDER ?? "anthropic",
    ...(Number.isFinite(inputPerMillion) && Number.isFinite(outputPerMillion)
      ? { pricing: { inputPerMillion, outputPerMillion } }
      : {}),
  });
}
