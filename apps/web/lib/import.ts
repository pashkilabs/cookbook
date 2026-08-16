import { createClient } from "@supabase/supabase-js";
import {
  createHttpFetcher,
  extractWithLlm,
  importFromImages,
  importRecipe,
  providerFromEnv,
  type ExtractedRecipe,
  type ImportFailure,
  type ImportOutcome,
  type LlmCascade,
  type TierAttempt,
} from "@pashki/import";
import { createSupabaseImportCache } from "@pashki/import/supabase";
import { storeImportedPhoto } from "@pashki/import/photo-storage";
import { createPlatformClient } from "@pashki/platform-client";
import { createSupabasePlatformStore } from "@pashki/platform-client/supabase";
import { createEd25519Signer } from "@pashki/platform-client/crypto";

/**
 * The import service, wired up for the first time.
 *
 * **Tier 0 is never skipped.** The cascade only reaches a model when tiers 0 and 1 find nothing:
 * structured data is byte-identical, free, and scored 99.3% against the fixture set, so consulting
 * a model for a page that publishes it would be paying for a worse answer (decisions §48).
 *
 * Tier 2 is a **line-finder, not a quantity-reader** — it returns verbatim lines and `packages/core`
 * parses them, which is measured rather than assumed: on lines both find, model and parser are
 * within one percent, and the whole gain is in which lines get found.
 *
 * Server-side, and it has to be: a browser cannot fetch other websites (CORS and CSP), which is
 * the trap most of the prototype's complexity existed to work around.
 */
function serviceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export interface ImportAttemptResult {
  outcome: ImportOutcome;
  /** where the photo bytes were put, when there were any. Null until a photos row points at it. */
  storagePath: string | null;
  photoDimensions: { width: number; height: number } | null;
  /**
   * Why there is no photograph, when there should have been one.
   *
   * Carried rather than swallowed. A photo that would not store is not a failed import — the
   * recipe is the point — but discarding the reason is how `sharp` failing to load on a deployed
   * host looked like "this page has no picture" for days. The kind is enough to tell a missing
   * image from a broken image library.
   */
  photoFailure: { kind: string; detail: string } | null;
}

/**
 * Fetch, extract, and put the photo bytes somewhere — but create no rows.
 *
 * The object is uploaded now because this is when the bytes exist, and it is **unreachable until
 * the review is saved**: every storage policy resolves through a `photos` row, so an object with
 * no row is readable by nobody but the service role. That is exactly the state 090700 describes
 * for an import awaiting review.
 *
 * An abandoned review therefore leaves an orphaned object. That is a known gap with no reaper
 * (`docs/roadmap.md`), not something this route invented.
 */
/**
 * The model cascade, or nothing.
 *
 * Null when unconfigured, and the pipeline then behaves exactly as it did before — tiers 0 and 1
 * only. A deployment with no key is degraded, not broken, and says so rather than erroring on
 * every import.
 *
 * Read from the environment **server-side only**. `check-server-only.mjs` fails the build if this
 * module reaches a `"use client"` file, which is what keeps the key out of a browser bundle.
 */
export function cascadeFromEnv(): LlmCascade | null {
  const provider = providerFromEnv();
  const model = process.env.PASHKI_LLM_MODEL;
  if (!provider || !model) return null;

  const vision = process.env.PASHKI_LLM_VISION_MODEL;
  return {
    provider,
    models: [{ provider: provider.key, model, region: "us", temperature: 0 }],
    // a separate list, because the escalation order for images is its own question (§7)
    ...(vision
      ? { visionModels: [{ provider: provider.key, model: vision, region: "us" as const, temperature: 0 }] }
      : {}),
  };
}

export async function attemptImport(url: string, familyId: string): Promise<ImportAttemptResult> {
  const admin = serviceRole();
  const llm = cascadeFromEnv();
  const outcome = await importRecipe(url, {
    fetcher: createHttpFetcher(),
    cache: createSupabaseImportCache(admin),
    // tier 0 first, always: the model is reached only when the markup yields nothing
    ...(llm ? { llm } : {}),
  });

  if (!outcome.ok || !outcome.photo) {
    return { outcome, storagePath: null, photoDimensions: null, photoFailure: null };
  }

  const stored = await storeImportedPhoto(
    { familyId, bytes: outcome.photo.bytes },
    { supabase: admin },
  );
  if (!stored.ok) {
    // a photo that would not store is not a failed import — the recipe is the point
    console.warn(`[pashki] photo not stored: ${stored.failure.kind} — ${stored.failure.detail}`);
    return {
      outcome,
      storagePath: null,
      photoDimensions: null,
      photoFailure: { kind: stored.failure.kind, detail: stored.failure.detail },
    };
  }
  return {
    outcome,
    storagePath: stored.storagePath,
    photoDimensions: { width: stored.width, height: stored.height },
    photoFailure: null,
  };
}

/**
 * Spend one import from the household's allowance, through the seam.
 *
 * Never counted locally: `platform_spend_quota` is one conditional UPDATE in the database, and a
 * read-then-write would let two devices importing at the same moment both spend the last one.
 */
export async function spendImportQuota(accountId: string) {
  const signer = createEd25519Signer({
    keyId: process.env.PASHKI_TOKEN_KEY_ID!,
    privateKeyPem: process.env.PASHKI_TOKEN_PRIVATE_KEY!,
  });
  const platform = createPlatformClient({
    store: createSupabasePlatformStore(serviceRole()),
    accountId,
    signer,
  });
  return platform.consumeQuota("recipes", 1);
}

/**
 * A pasted caption, or a screenshot of one.
 *
 * There is no markup to read, so tiers 0 and 1 have nothing to do — this is the path tier 2 was
 * built for. Against the fixture set it scores **80.4% ± 2.8** where core's line parser alone
 * scores 48.9%, for about $0.0007 a caption (decisions §48).
 *
 * **Screenshots go through the sharp preparer.** Phone captures run 1.5–3.7 MB and the vision path
 * caps an image at 1.5 MB, so without it every reel is rejected before a call is made — which
 * reads as "vision failed" when nothing was tried (§49).
 */
export type PasteOutcome =
  | { ok: true; recipe: ExtractedRecipe; attempts: readonly TierAttempt[] }
  | { ok: false; failure: ImportFailure; attempts: readonly TierAttempt[] };

export async function attemptPasteImport(
  input: { text: string } | { images: readonly { bytes: Uint8Array; label: string }[] },
): Promise<PasteOutcome> {
  const llm = cascadeFromEnv();
  if (!llm) return { ok: false, failure: { kind: "vision-not-configured" }, attempts: [] };

  if ("images" in input) {
    /*
     * sharp is loaded here, not at module scope.
     *
     * It is a native addon, and a module-scope import pulls it into every route that touches this
     * file — which is how five routes returned 500 from the day they shipped, for wanting a bucket
     * name from a module that imported an image library (CLAUDE.md). Only the screenshot path
     * needs it, so only the screenshot path pays for it.
     */
    const { createSharpImagePreparer } = await import("@pashki/import/sharp");
    const outcome = await importFromImages(input.images, {
      cascade: llm,
      preparer: createSharpImagePreparer(),
    });
    return outcome.ok
      ? { ok: true, recipe: outcome.recipe, attempts: outcome.attempts }
      : { ok: false, failure: outcome.failure, attempts: outcome.attempts };
  }

  const result = await extractWithLlm({
    content: input.text,
    sourceUrl: "",
    sourceName: null,
    cascade: llm,
  });
  if (!result.recipe) {
    return {
      ok: false,
      failure: { kind: "no-recipe-found", url: "", triedTiers: ["llm"] },
      attempts: result.attempts,
    };
  }
  return { ok: true, recipe: result.recipe, attempts: result.attempts };
}
