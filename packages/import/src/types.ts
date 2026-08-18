import type { ParsedIngredient } from "@pashki/core";
import type { LlmCascade } from "./provider.js";

/**
 * Recipe import.
 *
 * Tier 0 reads the machine-readable recipe data a page published; tier 1 reads
 * microdata and recipe-plugin markup. Both are free and more accurate than any model,
 * because they read what the site said rather than interpreting it (decisions §6).
 * Tier 2 is a schema-constrained model, and runs only when the deterministic tiers
 * found nothing and a cascade was configured — deterministic before AI is the control
 * flow, not a preference. Tier 3 (vision) is not built.
 */

export type Tier =
  /** structured recipe data published by the page */
  | "structured-data"
  /** microdata attributes and recipe-plugin markup */
  | "microdata"
  /** a model over the page's text, schema-constrained */
  | "llm"
  /** a vision model over user-supplied screenshots, fused into one recipe */
  | "vision";

/**
 * What one tier attempt did.
 *
 * Recorded for every tier tried, in order, so the eval harness can report which tier
 * answered and what the cheaper ones did — that hit rate is the cost lever
 * (decisions §6), and it cannot be reported if the cascade only returns its winner.
 */
export interface TierAttempt {
  tier: Tier;
  outcome:
    /** produced a usable recipe */
    | "hit"
    /** the tier found nothing to read */
    | "no-data"
    /** found a recipe but it was unusable, e.g. no ingredients */
    | "incomplete"
    /** the model returned output that failed schema validation — escalate */
    | "invalid-output"
    /** the provider itself failed */
    | "provider-error";
  /** which model, for the llm tier */
  model?: string;
  detail?: string;
}

/** What an extraction produced, before it becomes rows. */
export interface ExtractedRecipe {
  /**
   * null when the source names no dish — a caption reading "here are the toast details".
   *
   * A model that supplies one has invented it, which is the fault the review screen exists to
   * catch; the person importing supplies the title there rather than inheriting a guess.
   */
  title: string | null;
  servings: number | null;
  /** total time in minutes — a number can be scaled, "1 hr 20" cannot */
  totalMinutes: number | null;
  ingredients: ParsedIngredient[];
  /**
   * What the dish is, inferred at import and corrected on the review screen. Null when unknown.
   *
   * **Role on the plate is deliberately absent.** It is a property of a recipe's *use* — a lentil
   * soup is the protein on Monday and a side on Sunday — so one stored answer would be wrong often
   * enough that the filter stops being trusted.
   */
  course?: string | null;
  cuisine?: string | null;
  /** orthogonal to course: a soup is a main AND a soup */
  dishForm?: string | null;
  principalProtein?: string | null;
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
  // a client-supplied URL naming a host only the worker can reach. Refused before any
  // request, because the fetch happens server-side and the result is readable by the
  // household that asked for it
  | { kind: "private-address"; url: string; host: string }
  /**
   * Facebook, Instagram and TikTok never resolve. Rejected before a request is
   * made, with the route the user should take instead — four doomed attempts and a
   * timeout is a worse answer than an immediate one.
   */
  | { kind: "blocked-platform"; url: string; platform: string; useInstead: "screenshot" | "video" }
  | { kind: "fetch-failed"; url: string; status?: number; detail: string }
  | { kind: "not-html"; url: string; detail: string }
  | { kind: "no-recipe-found"; url: string; triedTiers: Tier[] }
  | { kind: "recipe-incomplete"; url: string; tier: Tier; missing: string[] }
  /** every supplied screenshot failed to decode or was too large to send */
  | { kind: "no-usable-images"; rejected: Array<{ image: string; detail: string }> }
  /** screenshots were supplied but no vision model is configured */
  | { kind: "vision-not-configured" }
  /** a queued job of a kind the runner does not drain yet */
  | { kind: "unsupported-job-kind"; jobKind: string }
  /** the household is out of allowance, or has no entitlement to spend against */
  | { kind: "quota-exceeded"; reason: "exceeded" | "no-entitlement"; detail?: string };

export interface ImportSuccess {
  recipe: ExtractedRecipe;
  /** every tier tried, in order — including the ones that did not answer */
  attempts: TierAttempt[];
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
  | { ok: false; failure: ImportFailure; attempts: TierAttempt[] };

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
/**
 * What the cache holds. The tier is stored alongside the recipe so a cache hit can
 * report which tier originally answered — otherwise every hit would have to claim a
 * tier it does not know, and the tier-0 hit rate, which is the metric that matters
 * most, would be quietly wrong.
 */
export interface CachedImport {
  recipe: ExtractedRecipe;
  tier: Tier;
}

export interface ImportCache {
  get(urlHash: string): Promise<CachedImport | null>;
  put(urlHash: string, entry: CachedImport): Promise<void>;
}

export interface ImportOptions {
  fetcher: Fetcher;
  cache?: ImportCache;
  /**
   * Tier 2. Omitted means the deterministic tiers only, which is this pipeline's
   * behaviour until a cascade is configured — no model is called unless one is
   * passed in.
   */
  llm?: LlmCascade;
  /** skip the cache read; still writes. For re-parsing after a parser fix. */
  refresh?: boolean;
  /** don't fetch the image, e.g. when only the text is wanted */
  skipPhoto?: boolean;
}
