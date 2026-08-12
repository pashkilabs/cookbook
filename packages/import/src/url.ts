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
/**
 * Hosts that only exist inside a network we are running in.
 *
 * The URL in an import job is supplied by a client and fetched **server-side**, by a
 * worker holding the service role, from inside our own network — and the extraction
 * result is written to `import_jobs.result_json`, which the submitting household can
 * read. That is a request forgery with a return channel: ask the worker to fetch
 * something only it can reach, and read the answer back out.
 *
 * Nothing checked the host. The scheme was validated and everything else was fetched.
 *
 * The obfuscated forms need no special handling: the URL parser normalises
 * `http://2130706433`, `http://0x7f.0.0.1` and `http://127.1` all to `127.0.0.1`
 * before this sees them. A dotless hostname is refused because a name with no public
 * suffix can only resolve on an internal resolver — `http://metadata` is the shape
 * this is for.
 *
 * **What this does not cover, and cannot:** a public name whose DNS record points at a
 * private address. Checking the host cannot see that; only checking the address the
 * socket actually connected to can, which belongs in the `Fetcher` adapter rather than
 * here. Recorded as a gap rather than implied to be closed.
 */
const INTERNAL_SUFFIX = /(^|\.)(localhost|local|internal|intranet|lan|corp|home\.arpa)$/i;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (INTERNAL_SUFFIX.test(host)) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return isPrivateV4(v4.slice(1).map(Number));

  if (host.includes(":")) {
    const lower = host.toLowerCase();
    // an IPv4 address wearing an IPv6 hat: ::ffff:7f00:1 is 127.0.0.1
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (mapped) {
      const high = Number.parseInt(mapped[1] ?? "0", 16);
      const low = Number.parseInt(mapped[2] ?? "0", 16);
      return isPrivateV4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
    }
    if (lower === "::1" || lower === "::") return true;
    // fc00::/7 unique local, fe80::/10 link local
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }

  // no dot at all: resolvable only by an internal resolver
  return !host.includes(".");
}

function isPrivateV4(octets: number[]): boolean {
  const [a = 0, b = 0] = octets;
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // carrier-grade NAT, and the reserved blocks nothing public should be in
  if (a === 100 && b >= 64 && b <= 127) return true;
  return a >= 224;
}

export function normaliseUrl(
  input: string,
): NormalisedUrl | Extract<ImportFailure, { kind: "invalid-url" | "private-address" }> {
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

  // Credentials would be sent to whatever host follows them, and they are a standard way
  // to make a URL read as one host to a human and another to a parser.
  if (url.username || url.password) {
    return { kind: "invalid-url", url: trimmed, detail: "credentials in URL" };
  }

  if (isPrivateHost(url.hostname)) {
    return { kind: "private-address", url: trimmed, host: url.hostname };
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
