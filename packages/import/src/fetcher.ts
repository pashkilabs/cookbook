import { isPrivateHost } from "./url.js";
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
  /** how many hops to follow — see `MAX_HOPS` */
  maxRedirects?: number;
  /**
   * Which redirect targets to refuse. Defaults to `isPrivateHost` and production passes nothing.
   *
   * It exists because of a loopback problem rather than a design preference: the redirect tests
   * run real servers on `127.0.0.1`, which the default correctly refuses — so a fixture for the
   * *happy* path cannot express the happy path, and a guard whose fixture cannot express what it
   * guards against is this project's oldest shape. Widening a gate for a test is the other one, so
   * the split is explicit: the **refusal** tests construct the fetcher with no options at all and
   * exercise the real predicate, and only the tests about *following* a chain pass `() => false`.
   */
  refuseRedirectTo?: (hostname: string) => boolean;
}

/**
 * How many redirects to follow, and why it is a small number rather than the platform's.
 *
 * Redirect-following is **load-bearing** here rather than incidental: Android's share sheet is how
 * a phone user sends themselves a recipe, and what it produces is a wrapper. `share.google` takes
 * two hops to reach the page (measured: `share.google/…` → `www.google.com/share.google?q=…` →
 * the recipe), a shortener takes one, and a shortener pointing at a wrapper takes three.
 *
 * `fetch`'s own limit is 20, which is a browser's answer to a question a browser has — a user
 * watching a page load can give up. Nothing here is watching, and a long chain is far more likely
 * to be a loop or a crawl than a recipe. Six clears every real wrapper shape with room and keeps
 * the SSRF surface below legible.
 */
const MAX_HOPS = 6;

const DEFAULTS = {
  userAgent: "PashkiBot/0.1 (+https://pashkilabs.com/bot)",
  timeoutMs: 15_000,
  maxHtmlBytes: 4_000_000,
  maxImageBytes: 12_000_000,
  maxRedirects: MAX_HOPS,
  refuseRedirectTo: isPrivateHost,
};

export function createHttpFetcher(options: HttpFetcherOptions = {}): Fetcher {
  const settings = { ...DEFAULTS, ...options };

  /**
   * Follow redirects by hand, so every hop's host is checked.
   *
   * `redirect: "follow"` hands the whole chain to the platform, which checks nothing we care
   * about — `normaliseUrl` refuses a private address *as input* and a redirect is a request to a
   * host nothing has looked at. A public wrapper answering `302 Location: http://127.0.0.1:…`
   * was followed and its body returned; the result is written to `import_jobs.result_json`, which
   * the household that submitted the URL can read. So the loop exists for the check, and the hop
   * budget is a side benefit rather than the point.
   *
   * A redirect is not an error and must not read as one: a wrapper's whole job is to answer 302,
   * and this project has a note about silence reading as success. The hop that refuses says which
   * hop and which host, because "that page could not be read" about a chain of three is not a
   * diagnosis.
   */
  async function get(
    url: string,
    accept: string,
  ): Promise<{ response: Response; finalUrl: string }> {
    let target = url;
    const chain: string[] = [url];

    for (let hop = 0; ; hop += 1) {
      const response = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(settings.timeoutMs),
        headers: { "user-agent": settings.userAgent, accept },
      });

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop >= settings.maxRedirects) {
          throw new Error(
            `more than ${settings.maxRedirects} redirects following ${url} (${chain.length} hops)`,
          );
        }
        let next: URL;
        try {
          // relative Locations are legal and common; resolve against the hop that sent it
          next = new URL(location, target);
        } catch {
          throw new Error(`hop ${hop + 1} from ${target} sent an unusable Location: ${location}`);
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          throw new Error(`hop ${hop + 1} redirected to an unsupported scheme ${next.protocol}`);
        }
        /*
         * The check `normaliseUrl` cannot make, in the only place that can make it. Named with
         * the host rather than folded into a generic refusal: this is the one failure here that
         * is a deliberate attempt rather than a broken link.
         */
        if (settings.refuseRedirectTo(next.hostname)) {
          throw new Error(
            `hop ${hop + 1} redirected to a private address (${next.hostname}) — refused`,
          );
        }
        target = next.toString();
        chain.push(target);
        continue;
      }

      if (!response.ok) {
        const via =
          chain.length > 1 ? ` (via ${chain.length - 1} redirect${chain.length > 2 ? "s" : ""})` : "";
        throw new Error(`HTTP ${response.status} for ${target}${via}`);
      }
      /*
       * `target` rather than `response.url`. Under `redirect: "manual"` the platform has not
       * followed anything, so what `response.url` means is a property of the implementation
       * rather than of the chain — and `finalUrl` is now load-bearing: it is what `source_url`
       * is derived from, so a re-read fetches the page rather than the wrapper.
       */
      return { response, finalUrl: target };
    }
  }

  async function body(
    url: string,
    maxBytes: number,
    accept: string,
  ): Promise<{ response: Response; finalUrl: string }> {
    const { response, finalUrl } = await get(url, accept);
    // trust the header enough to refuse early, but never enough to skip the check
    // that reading the body performs anyway
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      throw new Error(`response declares ${declared} bytes, over the ${maxBytes} limit`);
    }
    return { response, finalUrl };
  }

  return {
    async page(url: string): Promise<FetchedPage> {
      const { response, finalUrl } = await body(
        url,
        settings.maxHtmlBytes,
        "text/html,application/xhtml+xml",
      );
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > settings.maxHtmlBytes) {
        throw new Error(`page is ${buffer.byteLength} bytes, over the limit`);
      }
      return {
        finalUrl,
        contentType: response.headers.get("content-type"),
        // UTF-8 regardless of what the page declares. Recipe sites that still serve
        // latin-1 exist, and the damage is a mangled é in an ingredient name that
        // the review screen can fix — worth less than a charset-detection dependency.
        html: new TextDecoder("utf-8").decode(buffer),
      };
    },

    async bytes(url: string): Promise<FetchedBytes> {
      const { response, finalUrl } = await body(url, settings.maxImageBytes, "image/*");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > settings.maxImageBytes) {
        throw new Error(`image is ${buffer.byteLength} bytes, over the limit`);
      }
      return {
        finalUrl,
        contentType: response.headers.get("content-type"),
        bytes: new Uint8Array(buffer),
      };
    },
  };
}
