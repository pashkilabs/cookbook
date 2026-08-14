import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RECIPE_PHOTO_BUCKET } from "./photo-bucket.js";
import { decodeImage } from "./image.js";

/**
 * Validate and store — the server side of the photo pipeline.
 *
 * **Server-only**, and needs the service role: the bucket is private and has no client
 * write policy, so nothing else can put an object there.
 *
 * **No resizing, and therefore no sharp** (decisions §37). Display sizes come from Supabase's
 * image transformation CDN on read, which architecture §5 already said — so resizing on ingest
 * was producing one more variant nobody displayed. Removing it takes a native module out of
 * every deployed function, which is what made this path fragile: sharp cannot be bundled, has to
 * be traced in by hand, and the tracing bloated seventeen serverless functions past a hosting
 * limit before anyone noticed the photographs had been missing for days.
 *
 * What is given up, stated rather than discovered later: the stored object is the publisher\'s
 * original, so it is larger and keeps whatever metadata it arrived with. Both are bounded — a
 * size cap below, and the CDN strips metadata when it transforms on read.
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
   * Refuse anything larger than this many bytes.
   *
   * The cap that resizing used to provide implicitly. Recipe hero images are usually well under
   * a megabyte; something far larger is a mistake or a hero video frame, and storing it costs a
   * shared 1 GB bucket more than the picture is worth.
   */
  maxBytes?: number;
}

export interface StoredPhoto {
  /** what goes in `photos.storage_path`, and what every storage policy matches on */
  storagePath: string;
  width: number;
  height: number;
  byteLength: number;
  /** as decoded, not as declared — the publisher\'s own format is what gets stored */
  contentType: string;
}

export type PhotoStorageFailure =
  | { kind: "not-an-image"; detail: string }
  | { kind: "too-large"; detail: string }
  | { kind: "upload-failed"; detail: string };

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

const DEFAULTS = { maxBytes: 8 * 1024 * 1024 };

/** What `decodeImage` reports, mapped to what Storage should serve it as. */
const CONTENT_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Store an imported photo. Returns a typed failure rather than throwing, the same as the rest of
 * this package.
 *
 * The bytes are validated by **decoding them**, not by trusting a content type — a proxy will
 * happily label an HTML error page as a JPEG, and that trap is old enough to be in CLAUDE.md.
 * `decodeImage` is our own header parser, so the validation survived sharp leaving.
 */
export async function storeImportedPhoto(
  input: StoreImportedPhotoInput,
  options: PhotoStorageOptions,
): Promise<PhotoStorageOutcome> {
  const bucket = options.bucket ?? RECIPE_PHOTO_BUCKET;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;

  const decoded = decodeImage(input.bytes);
  if (!decoded) {
    return {
      ok: false,
      failure: { kind: "not-an-image", detail: `${input.bytes.length} bytes that decode as nothing` },
    };
  }

  if (input.bytes.length > maxBytes) {
    return {
      ok: false,
      failure: {
        kind: "too-large",
        detail: `${input.bytes.length} bytes, over the ${maxBytes} limit`,
      },
    };
  }

  const contentType = CONTENT_TYPES[decoded.format] ?? "application/octet-stream";
  const storagePath = `${input.familyId}/${input.photoId ?? randomUUID()}.${decoded.format === "jpeg" ? "jpg" : decoded.format}`;

  const { error } = await options.supabase.storage
    .from(bucket)
    .upload(storagePath, input.bytes, {
      contentType,
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
    width: decoded.width,
    height: decoded.height,
    byteLength: input.bytes.length,
    contentType,
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
