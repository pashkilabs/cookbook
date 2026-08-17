import { createClient } from "@supabase/supabase-js";
import {
  createHttpFetcher,
  extractWithLlm,
  importFromImages,
  importRecipe,
  cascadeFromEnv,
  type ExtractedRecipe,
  type ImportFailure,
  type ImportOutcome,
  type LlmCascade,
  type TierAttempt,
  createPassthroughImagePreparer,
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
/**
 * One builder, shared with the eval (`packages/import`).
 *
 * It used to be built here as well, and the two drifted: the eval knew about the Anthropic vision
 * provider and this did not, so production sent an Anthropic model name to Together. A model swap
 * has one site now.
 */
export { cascadeFromEnv };

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
 * **Screenshots are resized by the browser, not the server.** The client downscales and re-encodes
 * as JPEG before upload, so no image library runs in a serverless function — a native addon that
 * cannot be traced into a Vercel build has now caused two outages (§37, and again here).
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
     * No sharp. The client already did the work, and this is the second outage it has caused.
     *
     * The browser downscales to ~1500px and re-encodes as JPEG at 0.8 before upload, so what
     * arrives is already small — and `canvas.toBlob` re-encodes from raw pixels, which strips EXIF
     * outright. That covers two of the three things the sharp preparer bought:
     *
     *   resizing        the client does it, and better — it saves the upload too
     *   EXIF stripping  the canvas re-encode drops it entirely; a device identifier
     *                   never reaches a prompt
     *   orientation     `.rotate()` applies an EXIF tag a screenshot does not carry;
     *                   screenshots are captured upright
     *
     * **What is lost, said plainly:** the quality step-down that rescued an image still over the
     * byte ceiling. Without it such an image is *rejected* with a stated reason rather than
     * silently re-compressed. That is a worse outcome for one edge case and a better one for the
     * deployment, which is the same trade §37 made when it took sharp out the first time.
     *
     * Validation survives: `decodeImage` is our own header parser, so bytes are still decoded
     * rather than trusted (CLAUDE.md — never trust a content type).
     */
    const outcome = await importFromImages(input.images, {
      cascade: llm,
      preparer: createPassthroughImagePreparer(),
    });
    return outcome.ok
      ? { ok: true, recipe: outcome.recipe, attempts: outcome.attempts }
      : { ok: false, failure: outcome.failure, attempts: outcome.attempts };
  }

  const result = await extractWithLlm({
    content: input.text,
    sourceUrl: sourceUrlIn(input.text),
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

/**
 * The blog link a caption carries, if it carries one.
 *
 * A pasted caption has no URL of its own, so `source_url` was always empty — and a stored
 * ingredient list with no link back to where it came from is the weakest version of this feature.
 * Most captions do link their own recipe: the peach posset one ends with
 * `https://whatmollymade.com/peach-posset/` after four hashtag links.
 *
 * **First `http(s)` URL whose host is not a social platform.** Hashtag and profile links are the
 * caption's own furniture, not its source, and they always outnumber the real one. First candidate
 * wins rather than last or longest — captions put the blog link before the affiliate links, and
 * "the first one that is not Instagram" is a rule somebody can predict when it gets it wrong.
 *
 * Empty string when there is none, which is what the column held before and means "no source".
 */
const SOCIAL_HOSTS = [
  "instagram.com", "facebook.com", "fb.watch", "tiktok.com", "pinterest.com",
  "pin.it", "threads.net", "twitter.com", "x.com", "youtube.com", "youtu.be",
];

export function sourceUrlIn(text: string): string {
  for (const match of String(text ?? "").matchAll(/\bhttps?:\/\/[^\s<>"'()]+/gi)) {
    const raw = match[0].replace(/[.,;:!?]+$/, "");
    let host: string;
    try {
      host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue;
    }
    if (SOCIAL_HOSTS.some((social) => host === social || host.endsWith(`.${social}`))) continue;
    return raw;
  }
  return "";
}
