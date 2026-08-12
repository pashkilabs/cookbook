import type { ParsedIngredient } from "@pashki/core";

/**
 * Recipe import, deterministic tiers only.
 *
 * Nothing here calls a model. Tier 0 reads the machine-readable recipe data a page
 * published; tier 1 reads microdata and recipe-plugin markup. Both are free and
 * more accurate than any model, because they read what the site said rather than
 * interpreting it (decisions §6). Tiers 2 and 3 arrive behind the same
 * `ImportOutcome`, and cannot be judged until the eval set has real fixtures.
 */

export type Tier =
  /** structured recipe data published by the page */
  | "structured-data"
  /** microdata attributes and recipe-plugin markup */
  | "microdata";

/** What an extraction produced, before it becomes rows. */
export interface ExtractedRecipe {
  title: string;
  servings: number | null;
  /** total time in minutes — a number can be scaled, "1 hr 20" cannot */
  totalMinutes: number | null;
  ingredients: ParsedIngredient[];
  /** ordered method steps, as the source wrote them */
  steps: string[];
  /** resolved absolute URL, or null when the page offered none we could use */
  imageUrl: string | null;
  sourceUrl: string;
  sourceName: string | null;
}

/**
 * An image that was actually decoded.
 *
 * `format` and the dimensions come from parsing the bytes, never from the response
 * headers — a proxy will happily claim `image/jpeg` for an HTML error page.
 */
export interface ImportedPhoto {
  url: string;
  format: "jpeg" | "png" | "webp" | "gif";
  width: number;
  height: number;
  bytes: Uint8Array;
}

/**
 * Why an import did not produce a recipe.
 *
 * A discriminated union rather than exceptions: every one of these is an ordinary
 * outcome the review screen has to explain to somebody, and `catch` blocks lose the
 * detail that makes them explicable.
 */
export type ImportFailure =
  | { kind: "invalid-url"; url: string; detail: string }
  /**
   * Facebook, Instagram and TikTok never resolve. Rejected before a request is
   * made, with the route the user should take instead — four doomed attempts and a
   * timeout is a worse answer than an immediate one.
   */
  | { kind: "blocked-platform"; url: string; platform: string; useInstead: "screenshot" | "video" }
  | { kind: "fetch-failed"; url: string; status?: number; detail: string }
  | { kind: "not-html"; url: string; detail: string }
  | { kind: "no-recipe-found"; url: string; triedTiers: Tier[] }
  | { kind: "recipe-incomplete"; url: string; tier: Tier; missing: string[] };

export interface ImportSuccess {
  recipe: ExtractedRecipe;
  /** null when the page had no usable image, or the candidate failed to decode */
  photo: ImportedPhoto | null;
  tier: Tier;
  /** true when the recipe came from import_cache and nothing was fetched */
  fromCache: boolean;
  /** sha256 of the normalised URL — the cache key, shared across every household */
  urlHash: string;
}

export type ImportOutcome =
  | ({ ok: true } & ImportSuccess)
  | { ok: false; failure: ImportFailure };

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface FetchedPage {
  /** after redirects, so relative URLs resolve against the right base */
  finalUrl: string;
  contentType: string | null;
  html: string;
}

export interface FetchedBytes {
  finalUrl: string;
  contentType: string | null;
  bytes: Uint8Array;
}

/**
 * All network access, behind one port.
 *
 * A browser cannot fetch other websites — CORS and CSP block it and public relays
 * are unreliable — so this only ever runs server-side. Injecting it also means the
 * tests never touch the network, which is the difference between a suite that runs
 * in CI and one that flakes.
 */
export interface Fetcher {
  page(url: string): Promise<FetchedPage>;
  bytes(url: string): Promise<FetchedBytes>;
}

/**
 * The shared import cache, keyed by URL hash and never by family.
 *
 * A recipe that goes round Facebook is fetched and parsed once for the entire user
 * base (architecture §11), so this is deliberately not household-scoped and holds
 * nothing household-identifying.
 */
export interface ImportCache {
  get(urlHash: string): Promise<ExtractedRecipe | null>;
  put(urlHash: string, recipe: ExtractedRecipe): Promise<void>;
}

export interface ImportOptions {
  fetcher: Fetcher;
  cache?: ImportCache;
  /** skip the cache read; still writes. For re-parsing after a parser fix. */
  refresh?: boolean;
  /** don't fetch the image, e.g. when only the text is wanted */
  skipPhoto?: boolean;
}
