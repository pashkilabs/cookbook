import type { FetchedBytes, FetchedPage, Fetcher } from "./types.js";

/**
 * The default fetcher. **Server-side only** — a browser cannot fetch other websites,
 * and the relays that claim to are unreliable.
 */
export interface HttpFetcherOptions {
  /** identify honestly; some sites serve a different page to an unknown client */
  userAgent?: string;
  timeoutMs?: number;
  /** a recipe page that large is not a recipe page */
  maxHtmlBytes?: number;
  maxImageBytes?: number;
}

const DEFAULTS = {
  userAgent: "PashkiBot/0.1 (+https://pashkilabs.com/bot)",
  timeoutMs: 15_000,
  maxHtmlBytes: 4_000_000,
  maxImageBytes: 12_000_000,
};

export function createHttpFetcher(options: HttpFetcherOptions = {}): Fetcher {
  const settings = { ...DEFAULTS, ...options };

  async function get(url: string, maxBytes: number, accept: string): Promise<Response> {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(settings.timeoutMs),
      headers: { "user-agent": settings.userAgent, accept },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    // trust the header enough to refuse early, but never enough to skip the check
    // that reading the body performs anyway
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      throw new Error(`response declares ${declared} bytes, over the ${maxBytes} limit`);
    }
    return response;
  }

  return {
    async page(url: string): Promise<FetchedPage> {
      const response = await get(url, settings.maxHtmlBytes, "text/html,application/xhtml+xml");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > settings.maxHtmlBytes) {
        throw new Error(`page is ${buffer.byteLength} bytes, over the limit`);
      }
      return {
        finalUrl: response.url || url,
        contentType: response.headers.get("content-type"),
        // UTF-8 regardless of what the page declares. Recipe sites that still serve
        // latin-1 exist, and the damage is a mangled é in an ingredient name that
        // the review screen can fix — worth less than a charset-detection dependency.
        html: new TextDecoder("utf-8").decode(buffer),
      };
    },

    async bytes(url: string): Promise<FetchedBytes> {
      const response = await get(url, settings.maxImageBytes, "image/*");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > settings.maxImageBytes) {
        throw new Error(`image is ${buffer.byteLength} bytes, over the limit`);
      }
      return {
        finalUrl: response.url || url,
        contentType: response.headers.get("content-type"),
        bytes: new Uint8Array(buffer),
      };
    },
  };
}
