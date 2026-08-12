import { createHash } from "node:crypto";
import type { ImportFailure } from "./types.js";

/**
 * Platforms whose links never resolve to a page containing the recipe.
 *
 * Detected and rejected up front rather than attempted. The prototype let a user
 * wait through four doomed attempts and a timeout before failing; an immediate
 * answer with the route they should take instead is a better one. Pulling the media
 * server-side is also ruled out by decisions §12 — the user shares the file.
 */
const BLOCKED: Array<{ pattern: RegExp; platform: string; useInstead: "screenshot" | "video" }> = [
  { pattern: /(^|\.)facebook\.com$/i, platform: "Facebook", useInstead: "screenshot" },
  { pattern: /(^|\.)fb\.(com|watch)$/i, platform: "Facebook", useInstead: "screenshot" },
  { pattern: /(^|\.)instagram\.com$/i, platform: "Instagram", useInstead: "screenshot" },
  { pattern: /(^|\.)instagr\.am$/i, platform: "Instagram", useInstead: "screenshot" },
  { pattern: /(^|\.)tiktok\.com$/i, platform: "TikTok", useInstead: "video" },
];

/** Tracking parameters that change the URL without changing the page. */
const TRACKING = /^(utm_|fbclid$|gclid$|mc_(c|e)id$|igshid$|ref$|ref_src$|si$|epik$)/i;

export interface NormalisedUrl {
  /** what to fetch and what to hash */
  href: string;
  host: string;
}

/**
 * Reduce a URL to the page it identifies.
 *
 * The point is cache hits: the same recipe shared by four people arrives with four
 * different tracking parameters, and each one would otherwise be fetched and parsed
 * separately. Sorting the surviving parameters means `?a=1&b=2` and `?b=2&a=1` are
 * one entry too.
 *
 * The fragment goes: it is never sent to a server, so it cannot change the response.
 */
export function normaliseUrl(
  input: string,
): NormalisedUrl | Extract<ImportFailure, { kind: "invalid-url" }> {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return { kind: "invalid-url", url: trimmed, detail: "empty" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: "invalid-url", url: trimmed, detail: "not a URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "invalid-url", url: trimmed, detail: `unsupported scheme ${url.protocol}` };
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.protocol = "https:";
  // default ports carry no information
  if (url.port === "443" || url.port === "80") url.port = "";

  const keep = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [key, value] of keep) url.searchParams.append(key, value);

  // a trailing slash on a path is the same page; on the root it is canonical
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return { href: url.toString(), host: url.hostname };
}

export function blockedPlatform(
  host: string,
): Extract<ImportFailure, { kind: "blocked-platform" }> | null {
  for (const entry of BLOCKED) {
    if (entry.pattern.test(host)) {
      return {
        kind: "blocked-platform",
        url: host,
        platform: entry.platform,
        useInstead: entry.useInstead,
      };
    }
  }
  return null;
}

/**
 * The cache key. sha256 of the normalised URL, hex.
 *
 * Hashed rather than stored raw so the key is a fixed length and the cache table
 * carries no browsing history in a human-readable column.
 */
export function hashUrl(normalisedHref: string): string {
  return `sha256:${createHash("sha256").update(normalisedHref, "utf8").digest("hex")}`;
}

/** Resolve a possibly-relative URL against the page it was found on. */
export function absoluteUrl(candidate: string, base: string): string | null {
  const value = String(candidate ?? "").trim();
  if (!value) return null;
  try {
    const resolved = new URL(value, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.toString();
  } catch {
    return null;
  }
}
