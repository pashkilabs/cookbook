/**
 * When a cached extraction stops being worth serving.
 *
 * `import_cache` is one row per URL for the **entire user base** (architecture §11), which is
 * what makes it valuable and also what makes a wrong entry expensive: a bad parse is served to
 * every household that ever imports that link, indefinitely. Until now nothing expired at all —
 * `fetched_at` was written and read by nothing.
 *
 * Two different things go stale, and one policy cannot cover both.
 *
 * ---------------------------------------------------------------------------
 * A parser fix must reach entries it did not write
 * ---------------------------------------------------------------------------
 *
 * This is the failure worth designing against, because it has already happened twice: the tier-0
 * extractor was corrected once for image references — a bare `{"@id": ...}` overwriting the real
 * node it pointed at — and once for fetching the cache key instead of the URL as written. Both
 * times, every cached entry kept the old result. Shipping the fix changed nothing for anyone who
 * had already imported the page, and nothing anywhere reported that.
 *
 * Age alone cannot solve it. A fix ships today; entries written yesterday stay wrong until the
 * clock runs out, and shortening the clock enough to matter throws away the cache's whole
 * economic argument.
 *
 * So: **a version stamp.** Bump `EXTRACTOR_VERSION` and every entry written by an older
 * extractor is a miss on next use. Correctness propagates as fast as people ask for it, and
 * costs one re-fetch per URL actually wanted.
 *
 * The asymmetry is the point, and is why this is a hand-maintained integer rather than something
 * clever: **bumping unnecessarily costs a re-fetch, and forgetting to bump costs every household
 * a wrong recipe forever.** When unsure, bump. A hash of the extractor source would remove the
 * discipline but would also invalidate the world on a comment change, which makes the cheap
 * mistake expensive and inverts exactly the asymmetry that makes this safe.
 *
 * ---------------------------------------------------------------------------
 * A page changes under us
 * ---------------------------------------------------------------------------
 *
 * The version stamp says nothing about this: the parser is right and the source moved. A recipe
 * gets a correction, a blog reworks its amounts, a URL is reused for something else. Nothing
 * observes it, because we only fetch a page once.
 *
 * So: **an age.** Thirty days. Recipe pages drift slowly, and at tiers 0 and 1 a miss costs one
 * HTTP request and no model call, so the ceiling is cheap. It is deliberately generous rather
 * than clever — this is the bound on how wrong we can be, not an attempt to detect change.
 *
 * *Revisit when tier 2 is wired:* a miss then costs a model call, and thirty days may become the
 * wrong trade in the other direction.
 */

/**
 * Bump when extraction output could change for the same input.
 *
 * 1 — the first version to be stamped. Rows written before this migration have 0 and are treated
 *     as stale, which is correct: they were written by the extractor as it stood before the
 *     `fetchUrl` and image-reference corrections.
 */
/*
 * What each version means, so the next change can see whether it needs a bump.
 *
 *   1  the original stamped extractor
 *   2  the method is asked for (steps went 0/35 to 35/35 on the caption set), and course and
 *      cuisine are inferred. Entries written at 1 carry an empty steps array and neither
 *      classification field — a wrong recipe, served confidently, exactly what the stamp exists
 *      to expire.
 *
 * This sat at 1 through both changes. The stamp worked; nobody turned it. Recording the meanings
 * rather than only the number is the cheap half of not repeating that — a bare integer gives a
 * later reader nothing to compare their change against.
 */
export const EXTRACTOR_VERSION = 2;

/** How long an entry is served before the page is read again. */
export const CACHE_MAX_AGE_DAYS = 30;

export interface CacheEntryAge {
  /** `import_cache.extractor_version`; absent or 0 for rows written before stamping */
  extractorVersion: number | null;
  /** `import_cache.fetched_at` */
  fetchedAt: string | null;
}

export type CacheStaleness = "fresh" | "stale-version" | "stale-age" | "unknown-age";

/**
 * Why an entry should or should not be served.
 *
 * Returns a reason rather than a boolean so a caller can log which of the two policies fired —
 * "the parser moved" and "the page might have" are different facts, and a single `false` would
 * make the version stamp's effect unmeasurable.
 *
 * An entry with no `fetched_at` is `unknown-age` and treated as stale. A row that cannot say when
 * it was written cannot be argued to be fresh, and the column is `not null` in the schema, so
 * this only fires for something that has already gone wrong.
 */
export function cacheStaleness(
  entry: CacheEntryAge,
  now: Date = new Date(),
  maxAgeDays: number = CACHE_MAX_AGE_DAYS,
): CacheStaleness {
  if ((entry.extractorVersion ?? 0) !== EXTRACTOR_VERSION) return "stale-version";

  if (!entry.fetchedAt) return "unknown-age";
  const fetchedAt = Date.parse(entry.fetchedAt);
  if (Number.isNaN(fetchedAt)) return "unknown-age";

  const ageMs = now.getTime() - fetchedAt;
  // a clock skew putting the row in the future is not staleness; serving it is fine
  if (ageMs > maxAgeDays * 86_400_000) return "stale-age";

  return "fresh";
}

export const isCacheEntryFresh = (
  entry: CacheEntryAge,
  now?: Date,
  maxAgeDays?: number,
): boolean => cacheStaleness(entry, now, maxAgeDays) === "fresh";
