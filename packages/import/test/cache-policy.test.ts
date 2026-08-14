import { describe, expect, it } from "vitest";
import {
  CACHE_MAX_AGE_DAYS,
  EXTRACTOR_VERSION,
  cacheStaleness,
  isCacheEntryFresh,
} from "../src/cache-policy.js";

/**
 * When a shared cache entry stops being worth serving.
 *
 * `import_cache` is one row per URL for every household, so a wrong entry is wrong for everybody
 * until something invalidates it. Two policies, because two different things go stale.
 */
const NOW = new Date("2026-08-14T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const fresh = { extractorVersion: EXTRACTOR_VERSION, fetchedAt: daysAgo(1) };

describe("a cached extraction", () => {
  it("is served when the parser and the page are both recent enough", () => {
    expect(cacheStaleness(fresh, NOW)).toBe("fresh");
    expect(isCacheEntryFresh(fresh, NOW)).toBe(true);
  });

  describe("a parser fix reaching entries it did not write", () => {
    it("discards an entry written by an older extractor, however recent", () => {
      // the failure this exists for: the tier-0 extractor has been corrected twice and both
      // times every cached entry kept the old result for every household
      const yesterday = { extractorVersion: EXTRACTOR_VERSION - 1, fetchedAt: daysAgo(0) };
      expect(cacheStaleness(yesterday, NOW)).toBe("stale-version");
    });

    it("discards an entry written before stamping existed", () => {
      // the column defaults to 0, so every pre-migration row is stale — which is right, they
      // predate the corrections
      expect(cacheStaleness({ extractorVersion: 0, fetchedAt: daysAgo(0) }, NOW)).toBe("stale-version");
      expect(cacheStaleness({ extractorVersion: null, fetchedAt: daysAgo(0) }, NOW)).toBe("stale-version");
    });

    it("discards an entry from a newer extractor too", () => {
      // a rollback, or two versions deployed at once. "Not this version" is the test, not
      // "older than this version" — serving output from a parser we are not running is the
      // same problem in the other direction.
      const newer = { extractorVersion: EXTRACTOR_VERSION + 1, fetchedAt: daysAgo(0) };
      expect(cacheStaleness(newer, NOW)).toBe("stale-version");
    });

    it("reports the version as the reason before it considers age", () => {
      // both stale: the version is the actionable one, and a single boolean would make the
      // stamp's effect unmeasurable
      const both = { extractorVersion: 0, fetchedAt: daysAgo(400) };
      expect(cacheStaleness(both, NOW)).toBe("stale-version");
    });
  });

  describe("a page changing under us", () => {
    it("keeps an entry until the age is exceeded", () => {
      expect(cacheStaleness({ ...fresh, fetchedAt: daysAgo(CACHE_MAX_AGE_DAYS - 1) }, NOW)).toBe("fresh");
    });

    it("discards one past it", () => {
      expect(cacheStaleness({ ...fresh, fetchedAt: daysAgo(CACHE_MAX_AGE_DAYS + 1) }, NOW)).toBe("stale-age");
    });

    it("takes the age as an argument, so the trade can move when tier 2 is wired", () => {
      // a miss costs one HTTP request today and will cost a model call later
      const entry = { ...fresh, fetchedAt: daysAgo(10) };
      expect(cacheStaleness(entry, NOW, 7)).toBe("stale-age");
      expect(cacheStaleness(entry, NOW, 90)).toBe("fresh");
    });
  });

  describe("rows that cannot answer", () => {
    it("treats a missing timestamp as stale rather than assuming it is fine", () => {
      expect(cacheStaleness({ ...fresh, fetchedAt: null }, NOW)).toBe("unknown-age");
    });

    it("treats an unparseable timestamp as stale", () => {
      expect(cacheStaleness({ ...fresh, fetchedAt: "not a date" }, NOW)).toBe("unknown-age");
    });

    it("serves a row dated in the future rather than calling clock skew staleness", () => {
      const ahead = { ...fresh, fetchedAt: new Date(NOW.getTime() + 86_400_000).toISOString() };
      expect(cacheStaleness(ahead, NOW)).toBe("fresh");
    });
  });
});
