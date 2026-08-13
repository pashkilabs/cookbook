import { createClient } from "@supabase/supabase-js";
import {
  createHttpFetcher,
  importRecipe,
  type ImportOutcome,
} from "@pashki/import";
import { createSupabaseImportCache } from "@pashki/import/supabase";
import { storeImportedPhoto } from "@pashki/import/photo-storage";
import { createPlatformClient } from "@pashki/platform-client";
import { createSupabasePlatformStore } from "@pashki/platform-client/supabase";
import { createEd25519Signer } from "@pashki/platform-client/crypto";

/**
 * The import service, wired up for the first time.
 *
 * **Tiers 0 and 1 only.** `ImportOptions.llm` is omitted, and the pipeline calls no model unless
 * a cascade is passed in — so this cannot reach tier 2 by accident. Tiers 2 and 3 wait on the
 * eval fixtures, which is what decides the model rather than a guess.
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
export async function attemptImport(url: string, familyId: string): Promise<ImportAttemptResult> {
  const admin = serviceRole();
  const outcome = await importRecipe(url, {
    fetcher: createHttpFetcher(),
    cache: createSupabaseImportCache(admin),
    // no `llm`: tiers 0 and 1 only, by construction rather than by discipline
  });

  if (!outcome.ok || !outcome.photo) {
    return { outcome, storagePath: null, photoDimensions: null };
  }

  const stored = await storeImportedPhoto(
    { familyId, bytes: outcome.photo.bytes },
    { supabase: admin },
  );
  if (!stored.ok) {
    // a photo that would not store is not a failed import — the recipe is the point
    return { outcome, storagePath: null, photoDimensions: null };
  }
  return {
    outcome,
    storagePath: stored.storagePath,
    photoDimensions: { width: stored.width, height: stored.height },
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
