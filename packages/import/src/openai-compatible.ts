import type { ImageInput, LlmProvider, LlmRequest, LlmResponse } from "./provider.js";
import { acceptsTemperature, anthropicModelMismatch, visionProviderFromEnv } from "./anthropic.js";

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
/**
 * A request timeout must be shorter than the function that holds it.
 *
 * This was 60_000 — the same as the serverless duration cap the routes calling it run under.
 * A call that actually used its full timeout would therefore be killed by the platform *at the
 * same moment* it gave up, so nothing downstream ever ran: no fallback, no write, no record of
 * what happened. The work is paid for and the outcome is unobservable, which is the worst of
 * both — and it only shows up when the provider is slow, which is exactly when it matters.
 *
 * Forty-five leaves fifteen seconds for the code that has to run afterwards: taking the
 * consensus, writing the partition, answering. Against observed call times of twelve to forty
 * seconds it is not tight.
 *
 * **The rule, not the number:** whenever a timeout sits inside something with its own deadline,
 * the inner one has to finish first with room for the work that follows it. Two equal deadlines
 * is a race whose loser is always the error handling.
 */
const DEFAULT_TIMEOUT_MS = 45_000;

export interface OpenAiCompatibleOptions {
  /** e.g. `https://api.openai.com/v1`. No trailing slash. */
  baseUrl: string;
  apiKey: string;
  /** names the provider in `ModelConfig.provider` and in the eval's cost report */
  key?: string;
  /** injected so tests need no network and production needs no globals */
  fetch?: typeof globalThis.fetch;
  /** per request, in milliseconds. See `DEFAULT_TIMEOUT_MS` for why the default is what it is. */
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
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
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

/**
 * The text tier's wiring fault, or null — the symmetric twin of `anthropicModelMismatch`.
 *
 * Vision had a construction-time guard and text had none, which is the asymmetry this closes.
 * The faults below are **certain**, not heuristic: each is a credential or an id that the
 * OpenAI-compatible protocol cannot carry at all, so naming it at boot is strictly better than
 * learning about it as an empty extraction.
 *
 * The third case is not hypothetical — it is this repo's own regression. Wiring Anthropic into
 * the eval left production sending `claude-haiku-4-5` to Together's Chat Completions endpoint and
 * getting nothing back, while a card read perfectly in the measurement. `cascadeFromEnv` closed
 * the *code* site for that class by making both callers share one builder; this closes the
 * *configuration* site, which a shared builder cannot reach on its own.
 *
 * **What this cannot do, stated so nothing reads it as more than it is.** A well-formed key that
 * the provider has revoked passes every check here. Dialect is checkable offline; acceptance is
 * not, and the text tier's failure on a rejected key is *soft* — the cascade falls back to the
 * deterministic tier, which handles most recipe sites correctly, so the symptom is captions and
 * screenshots quietly extracting worse rather than anything erroring. That is the gap the
 * fingerprint on `/api/health` exists to close, by turning "is production's key the one that
 * works locally" from a guess into a comparison.
 */
export function textWiringFault(
  apiKey: string,
  model: string,
  baseUrl: string | undefined,
): string | null {
  if (apiKey.startsWith("sk-ant-")) {
    return (
      `the text tier is configured with an Anthropic key (sk-ant-…), and the text path posts ` +
      `Chat Completions — a protocol Anthropic does not speak (§7). Set PASHKI_LLM_API_KEY to a ` +
      `key for the provider at PASHKI_LLM_BASE_URL, or configure this model as the vision tier.`
    );
  }
  if (baseUrl && /(^|\/\/|\.)api\.anthropic\.com/i.test(baseUrl)) {
    return (
      `PASHKI_LLM_BASE_URL points at api.anthropic.com, which serves /v1/messages and not ` +
      `/chat/completions. The text tier speaks the OpenAI-compatible protocol; Anthropic is ` +
      `reached through the vision provider instead.`
    );
  }
  if (/^claude-/i.test(model)) {
    return (
      `the text model "${model}" is an Anthropic id, and the text tier posts Chat Completions to ` +
      `${baseUrl ?? "the configured base URL"}. This is the regression that shipped once already: ` +
      `an Anthropic model id on an OpenAI-compatible endpoint returns nothing, quietly. Set ` +
      `PASHKI_LLM_MODEL to a model the configured provider serves.`
    );
  }
  return null;
}

/**
 * The whole cascade from the environment — one builder, so a model swap has one site.
 *
 * regression: the eval and the web app each built their own, and wiring Anthropic into the eval
 * left the product sending `claude-haiku-4-5` to Together's Chat Completions endpoint. A card read
 * perfectly in the measurement and returned nothing in the app, which is the divergence this
 * removes: **the path that is measured and the path that ships are now the same code.**
 *
 * Null when text is unconfigured, so a deployment without a key is degraded rather than broken.
 * Vision is optional on top: `visionProviderFromEnv` speaks a different wire protocol (§7), and
 * its absence means screenshots are refused rather than guessed at.
 */
export function cascadeFromEnv(
  env: Record<string, string | undefined> = process.env,
): import("./provider.js").LlmCascade | null {
  const provider = providerFromEnv(env);
  const model = env.PASHKI_LLM_MODEL;
  if (!provider || !model) return null;

  const visionProvider = visionProviderFromEnv(env);
  const vision = env.PASHKI_LLM_VISION_MODEL;

  /*
   * Refuse at construction rather than at import time. A key and a model id that disagree is a
   * deployment fault, and the useful moment to say so is boot — not the first photograph a
   * household uploads, which learns about it as "no recipe could be read".
   */
  const visionKey = env.PASHKI_LLM_VISION_API_KEY;
  if (visionKey && vision) {
    const mismatch = anthropicModelMismatch(visionKey, vision);
    if (mismatch) throw new Error(mismatch);
  }

  /*
   * And the same for text, which had no construction-time guard at all — the asymmetry that
   * made the text tier's faults soft while vision's were loud. Checked after the null return
   * above, so an *absent* key still degrades rather than throwing: unconfigured and
   * misconfigured are different answers, and only the second is a deployment fault.
   */
  const textKey = env.PASHKI_LLM_API_KEY;
  if (textKey) {
    const fault = textWiringFault(textKey, model, env.PASHKI_LLM_BASE_URL);
    if (fault) throw new Error(fault);
  }

  return {
    provider,
    models: [{ provider: provider.key, model, region: "us", temperature: 0 }],
    ...(visionProvider ? { visionProvider } : {}),
    ...(vision
      ? {
          visionModels: [
            {
              provider: (visionProvider ?? provider).key,
              model: vision,
              region: "us" as const,
              // omitted for anything that rejects it — Claude 5 400s on temperature at all
              ...(acceptsTemperature(vision) ? { temperature: 0 } : {}),
            },
          ],
        }
      : {}),
  };
}
