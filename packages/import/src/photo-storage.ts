import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RECIPE_PHOTO_BUCKET } from "./photo-bucket.js";

/**
 * Fetch, resize, store — the server side of the photo pipeline.
 *
 * **Server-only**, and needs the service role: the bucket is private and has no client
 * write policy, so nothing else can put an object there.
 *
 * A separate entry point (`@pashki/import/photo-storage`) because it loads sharp.
 * Anything that only wants tiers 0 and 1 should not pay for libvips at import time.
 *
 * Deliberately does **not** insert a `photos` row. No import saves without the user
 * seeing it (CLAUDE.md), so the row is written when they accept the review — and until
 * it exists, the object is readable by nobody but the service role, because every
 * storage policy resolves through `photos.storage_path`. An abandoned import leaves an
 * unreachable object rather than a visible one.
 */

export { RECIPE_PHOTO_BUCKET } from "./photo-bucket.js";

export interface PhotoStorageOptions {
  /** service role: the bucket has no client write policy */
  supabase: SupabaseClient;
  bucket?: string;
  /**
   * Longest edge to keep.
   *
   * One size on ingest, not a set of variants: display sizes come from Supabase's
   * image transformation CDN on read, so storing four crops of every photo would be
   * paying twice. Also a placeholder — nothing has measured what a recipe card needs.
   */
  maxDimension?: number;
  quality?: number;
}

export interface StoredPhoto {
  /** what goes in `photos.storage_path`, and what every storage policy matches on */
  storagePath: string;
  width: number;
  height: number;
  byteLength: number;
  contentType: "image/jpeg";
}

export type PhotoStorageFailure =
  | { kind: "not-an-image"; detail: string }
  | { kind: "resize-failed"; detail: string }
  | { kind: "upload-failed"; detail: string }
  /** the image library could not be loaded here at all — see `loadSharp` */
  | { kind: "resizer-unavailable"; detail: string };

/**
 * sharp, loaded when it is needed rather than when this module is imported.
 *
 * **A top-level `import sharp` made every route that touched this file die.** sharp is a native
 * addon; on Vercel's linux runtime it failed to load, and because the import was at module scope
 * the failure took the whole route with it — five routes returning 500, including one that wanted
 * nothing from here but a bucket name. Locally it never reproduced, because the darwin binary is
 * sitting in `node_modules` for Node to find.
 *
 * Deferring it changes the blast radius from *the route* to *the photograph*. An import whose
 * picture cannot be resized is still an import; the recipe is the point. And the reason is
 * carried in the failure rather than thrown away, so the next person sees why instead of a 500.
 */
type Sharp = (typeof import("sharp"))["default"];
let sharpModule: Sharp | null = null;
let sharpFailure: string | null = null;

async function loadSharp(): Promise<{ ok: true; sharp: Sharp } | { ok: false; detail: string }> {
  if (sharpModule) return { ok: true, sharp: sharpModule };
  if (sharpFailure) return { ok: false, detail: sharpFailure };
  try {
    sharpModule = (await import("sharp")).default;
    return { ok: true, sharp: sharpModule };
  } catch (thrown) {
    // remembered, so a hot function does not retry a native load that cannot succeed
    sharpFailure = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, detail: sharpFailure };
  }
}

export type PhotoStorageOutcome =
  | ({ ok: true } & StoredPhoto)
  | { ok: false; failure: PhotoStorageFailure };

export interface StoreImportedPhotoInput {
  /** the household the photo belongs to; first path segment, so listings stay sane */
  familyId: string;
  bytes: Uint8Array;
  /** supply to overwrite a previous attempt rather than orphan it */
  photoId?: string;
}

const DEFAULTS = { maxDimension: 1600, quality: 82 };

/**
 * Resize an imported photo and store it. Returns a typed failure rather than throwing,
 * the same as the rest of this package.
 */
export async function storeImportedPhoto(
  input: StoreImportedPhotoInput,
  options: PhotoStorageOptions,
): Promise<PhotoStorageOutcome> {
  const bucket = options.bucket ?? RECIPE_PHOTO_BUCKET;
  const maxDimension = options.maxDimension ?? DEFAULTS.maxDimension;
  const quality = options.quality ?? DEFAULTS.quality;

  const loaded = await loadSharp();
  if (!loaded.ok) {
    return { ok: false, failure: { kind: "resizer-unavailable", detail: loaded.detail } };
  }
  const sharp = loaded.sharp;

  let resized;
  try {
    resized = await sharp(Buffer.from(input.bytes), { failOn: "error" })
      // apply EXIF orientation, then drop the metadata: a photo lifted off a page can
      // carry a location and a camera serial, and neither belongs in our storage
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    // sharp refuses non-images and truncated files with the same class of error, so
    // the distinction is worth drawing for whoever reads the failure
    return {
      ok: false,
      failure: /unsupported image format|Input buffer/i.test(detail)
        ? { kind: "not-an-image", detail }
        : { kind: "resize-failed", detail },
    };
  }

  const storagePath = `${input.familyId}/${input.photoId ?? randomUUID()}.jpg`;

  const { error } = await options.supabase.storage
    .from(bucket)
    .upload(storagePath, resized.data, {
      contentType: "image/jpeg",
      // an explicit photoId means "replace what was there", which is what a retried
      // import should do rather than leaving the first attempt behind
      upsert: input.photoId !== undefined,
    });

  if (error) {
    return { ok: false, failure: { kind: "upload-failed", detail: error.message } };
  }

  return {
    ok: true,
    storagePath,
    width: resized.info.width,
    height: resized.info.height,
    byteLength: resized.data.byteLength,
    contentType: "image/jpeg",
  };
}

/**
 * A signed URL for an object no client may read directly.
 *
 * Needed for the review screen: the photo has no `photos` row yet, so every policy
 * denies it, and the server has to hand out a time-limited URL instead. Short-lived by
 * default — this is a URL for a picture nobody has agreed to save.
 */
export async function createReviewPhotoUrl(
  storagePath: string,
  options: PhotoStorageOptions & { expiresInSeconds?: number },
): Promise<string | null> {
  const { data, error } = await options.supabase.storage
    .from(options.bucket ?? RECIPE_PHOTO_BUCKET)
    .createSignedUrl(storagePath, options.expiresInSeconds ?? 600);
  return error ? null : data.signedUrl;
}
