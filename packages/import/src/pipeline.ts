import type {
  ExtractedRecipe,
  ImportOptions,
  ImportOutcome,
  ImportedPhoto,
  Tier,
  TierAttempt,
} from "./types.js";
import {
  buildNodeIndex,
  collectJsonLd,
  findRecipeNode,
  flattenNodes,
  type JsonObject,
} from "./jsonld.js";
import { extractCanonicalUrl, extractMicrodata, extractSiteName } from "./microdata.js";
import { mapRecipeNode, missingFields } from "./recipe.js";
import { extractWithLlm, pageToText } from "./tier2.js";
import { decodeImage } from "./image.js";
import { blockedPlatform, hashUrl, normaliseUrl } from "./url.js";

/** Cheapest first. Tier 2 only runs when a cascade is configured. */
const DETERMINISTIC_TIERS: Tier[] = ["structured-data", "microdata"];

/**
 * Import a recipe from a URL.
 *
 * Order of operations is deliberate, cheapest first:
 *
 *   1. Normalise and reject platforms that never resolve — no request at all.
 *   2. Ask the shared cache. A recipe doing the rounds is parsed once for everybody.
 *   3. Fetch the page once, following redirects, and **resolve what was actually read**.
 *   4. Ask the cache again under the resolved URL, before extracting anything.
 *   5. Try each deterministic tier against the same HTML.
 *   6. Tier 2, only if the deterministic tiers found nothing and a cascade is
 *      configured. A model is never the first attempt (decisions §6).
 *   7. Fetch and decode the image.
 *
 * Step 3 is step 3 because a phone's share sheet does not hand over a recipe URL. It hands over
 * `share.google/CB96RGAg…`, or a shortener, or a Facebook interstitial, and the recipe is two
 * hops away. Those resolve perfectly well — which is exactly why they are dangerous to store: the
 * extraction succeeds, and `source_url` keeps the wrapper, so the section backfill and every
 * re-read fetch a redirect stub for the life of the recipe. Resolving is free, happens anyway, and
 * was simply not being written down.
 *
 * Never throws for an expected condition. Every failure is a typed `ImportFailure`,
 * because each one is something the review screen has to explain to a person, and a
 * caught exception has already lost the detail that makes it explicable.
 */
export async function importRecipe(url: string, options: ImportOptions): Promise<ImportOutcome> {
  const attempts: TierAttempt[] = [];

  const normalised = normaliseUrl(url);
  if ("kind" in normalised) return { ok: false, failure: normalised, attempts };

  const blocked = blockedPlatform(normalised.host);
  if (blocked) {
    // the original URL is more useful in the message than the bare host
    return { ok: false, failure: { ...blocked, url }, attempts };
  }

  const urlHash = hashUrl(normalised.href);

  if (options.cache && !options.refresh) {
    const cached = await options.cache.get(urlHash);
    if (cached) {
      /*
       * A hit produces the same recipe a miss would, photograph included.
       *
       * The cache carries the **source image URL** — a public address on somebody else's
       * website, already part of the extracted recipe — and a hit re-fetches it into the
       * requesting household's own storage. It cannot carry a storage path: `import_cache` is
       * one row for the entire user base, and a storage path is `<family_id>/<uuid>.jpg`. See
       * decisions §33.
       *
       * Returning no photo was the alternative, and it got worse as the product succeeded: the
       * better the shared cache works, the more households would receive recipes with no
       * picture. One image request is a small price for that not being true.
       */
      const photo = options.skipPhoto ? null : await fetchPhoto(cached.recipe.imageUrl, options);
      return {
        ok: true,
        recipe: cached.recipe,
        // the tier that originally answered, not a guess: a cache hit that claimed
        // tier 0 would quietly corrupt the hit rate that decides model spend
        tier: cached.tier,
        attempts: [{ tier: cached.tier, outcome: "hit", detail: "from cache" }],
        photo,
        fromCache: true,
        urlHash,
      };
    }
  }

  let page;
  try {
    // the URL as given, not the cache key — see NormalisedUrl.fetchUrl
    page = await options.fetcher.page(normalised.fetchUrl);
  } catch (thrown) {
    return {
      ok: false,
      failure: {
        kind: "fetch-failed",
        url: normalised.fetchUrl,
        detail: thrown instanceof Error ? thrown.message : String(thrown),
      },
      attempts,
    };
  }

  // A content type is worth trusting for "is this a web page" in a way it is not for
  // images: there is no dimension to recover, and a JSON or PDF response is not going
  // to yield a recipe whatever we do with it.
  if (page.contentType && !/text\/html|application\/xhtml/i.test(page.contentType)) {
    return {
      ok: false,
      failure: {
        kind: "not-html",
        url: normalised.fetchUrl,
        detail: `content type ${page.contentType}`,
        ...(page.finalUrl !== normalised.fetchUrl ? { resolvedUrl: page.finalUrl } : {}),
      },
      attempts,
    };
  }

  /*
   * What was actually read, which is not always what was asked for.
   *
   * `finalUrl` covers a wrapper, since following the redirect is what produced it. The canonical
   * link covers the case with no redirect at all — an AMP or `?amp=true` variant returns 200 and
   * serves the recipe, so the page's own head is the only thing that knows its real address.
   * Measured on both: `share.google/…` resolves by redirect, `?amp=true` by canonical, and
   * extraction from the AMP variant was byte-for-byte the same recipe.
   */
  // after the content-type check on purpose: a canonical link read out of something that is not
  // HTML is a string found in a PDF, and `not-html` carries `finalUrl` for the same reason
  const resolvedUrl = extractCanonicalUrl(page.html, page.finalUrl) ?? page.finalUrl;
  const wasWrapped = resolvedUrl !== normalised.fetchUrl;

  /*
   * The cache, asked a second time under the address we ended up at.
   *
   * The first lookup cannot do this — the key is computed before the fetch, which is the whole
   * economy of a pre-fetch cache. So a wrapper was a guaranteed miss and a guaranteed re-parse,
   * and every distinct share token for one recipe was its own row. One HTTP request is already
   * spent by the time we are here; what this saves is the extraction and, at tier 2, the model
   * call — which is the expensive half.
   */
  const resolvedHash = wasWrapped ? resolvedCacheKey(resolvedUrl) ?? urlHash : urlHash;
  if (options.cache && !options.refresh && resolvedHash !== urlHash) {
    const cached = await options.cache.get(resolvedHash);
    if (cached) {
      const photo = options.skipPhoto ? null : await fetchPhoto(cached.recipe.imageUrl, options);
      return {
        ok: true,
        recipe: cached.recipe,
        tier: cached.tier,
        attempts: [{ tier: cached.tier, outcome: "hit", detail: "from cache, by resolved URL" }],
        photo,
        fromCache: true,
        urlHash: resolvedHash,
      };
    }
  }

  const siteName = extractSiteName(page.html) ?? normalised.host;
  let recipe: ExtractedRecipe | null = null;
  let usedTier: Tier | null = null;

  for (const tier of DETERMINISTIC_TIERS) {
    const found = extractTier(tier, page.html, page.finalUrl, resolvedUrl, siteName);
    if (!found) {
      attempts.push({ tier, outcome: "no-data" });
      continue;
    }
    const missing = missingFields(found);
    if (missing.length > 0) {
      // a tier that produced something unusable should not stop the next one trying
      attempts.push({ tier, outcome: "incomplete", detail: missing.join(", ") });
      continue;
    }
    attempts.push({ tier, outcome: "hit" });
    recipe = found;
    usedTier = tier;
    break;
  }

  // Tier 2, last and only if asked for. Deterministic before AI is not a preference
  // here, it is the control flow.
  if (!recipe && options.llm) {
    const llm = await extractWithLlm({
      content: pageToText(page.html),
      sourceUrl: resolvedUrl,
      sourceName: siteName,
      cascade: options.llm,
    });
    attempts.push(...llm.attempts);
    if (llm.recipe && missingFields(llm.recipe).length === 0) {
      recipe = llm.recipe;
      usedTier = "llm";
      // the model is not asked for an image, so take whatever the markup offered
      const fromMarkup = imageFromMarkup(page.html, page.finalUrl, resolvedUrl, siteName);
      if (fromMarkup) recipe = { ...recipe, imageUrl: fromMarkup };
    }
  }

  if (!recipe || !usedTier) {
    const incomplete = attempts.find((attempt) => attempt.outcome === "incomplete");
    if (incomplete) {
      return {
        ok: false,
        failure: {
          kind: "recipe-incomplete",
          url: normalised.fetchUrl,
          tier: incomplete.tier,
          missing: (incomplete.detail ?? "").split(", ").filter(Boolean),
          ...(wasWrapped ? { resolvedUrl } : {}),
        },
        attempts,
      };
    }
    return {
      ok: false,
      failure: {
        kind: "no-recipe-found",
        url: normalised.fetchUrl,
        triedTiers: [...new Set(attempts.map((attempt) => attempt.tier))],
        ...(wasWrapped ? { resolvedUrl } : {}),
      },
      attempts,
    };
  }

  // `imageUrl` keeps whatever the page claimed even when the bytes would not decode.
  // That the page said so is a fact about the page; that we could not use it today
  // may be transient, and `photo: null` is what carries the failure. Nulling the URL
  // here would also make a refresh unable to retry.
  const photo = options.skipPhoto ? null : await fetchPhoto(recipe.imageUrl, options);

  if (options.cache) {
    try {
      await options.cache.put(urlHash, { recipe, tier: usedTier });
      /*
       * Under both addresses when they differ, because both are things a person will paste.
       *
       * The next household to import the *canonical* URL gets this parse rather than repeating
       * it, and so does the next one to paste this same wrapper. The rows carry identical
       * content, which is what makes writing two of them a cache rather than a divergence —
       * `import_cache` is one row set for the whole user base, so the saving compounds.
       */
      if (resolvedHash !== urlHash) {
        await options.cache.put(resolvedHash, { recipe, tier: usedTier });
      }
    } catch {
      // a cache write failing costs a re-parse next time, which is not worth failing
      // an import the user is watching
    }
  }

  return { ok: true, recipe, attempts, photo, tier: usedTier, fromCache: false, urlHash };
}

/**
 * The cache key for a resolved URL, or null if it cannot have one.
 *
 * Through `normaliseUrl` rather than hashed directly, so a wrapper's destination lands on the
 * *same* key as somebody pasting that destination by hand — which is the entire point of writing
 * the second row. Null rather than a throw for the case that cannot happen but would be silent if
 * it did: a page whose canonical link or redirect target no longer parses. The caller falls back
 * to the requested key, so a strange destination costs a duplicate row and never an import.
 */
function resolvedCacheKey(resolvedUrl: string): string | null {
  const normalised = normaliseUrl(resolvedUrl);
  return "kind" in normalised ? null : hashUrl(normalised.href);
}

function extractTier(
  tier: Tier,
  html: string,
  baseUrl: string,
  sourceUrl: string,
  sourceName: string | null,
): ExtractedRecipe | null {
  let node: JsonObject | null = null;
  let index = new Map<string, JsonObject>();

  if (tier === "structured-data") {
    const nodes = flattenNodes(collectJsonLd(html));
    // the index spans every node on the page, not just the recipe's own subtree —
    // an image reference usually points at an ImageObject defined elsewhere
    index = buildNodeIndex(nodes);
    node = findRecipeNode(nodes);
  } else if (tier === "microdata") {
    node = extractMicrodata(html);
  }

  if (!node) return null;
  return mapRecipeNode({ node, index, baseUrl, sourceUrl, sourceName, html });
}

/**
 * The image a page's markup offered, for when tier 2 answered.
 *
 * A model is never asked for an image URL — it would invent a plausible one, and a
 * wrong photo on somebody's recipe is worse than no photo. So even when the text came
 * from a model, the image still comes from the page.
 */
function imageFromMarkup(
  html: string,
  baseUrl: string,
  sourceUrl: string,
  sourceName: string | null,
): string | null {
  for (const tier of DETERMINISTIC_TIERS) {
    const found = extractTier(tier, html, baseUrl, sourceUrl, sourceName);
    if (found?.imageUrl) return found.imageUrl;
  }
  return null;
}

async function fetchPhoto(
  imageUrl: string | null,
  options: ImportOptions,
): Promise<ImportedPhoto | null> {
  if (!imageUrl) return null;
  try {
    const fetched = await options.fetcher.bytes(imageUrl);
    const decoded = decodeImage(fetched.bytes);
    if (!decoded) return null;
    return {
      url: fetched.finalUrl,
      format: decoded.format,
      width: decoded.width,
      height: decoded.height,
      bytes: fetched.bytes,
    };
  } catch {
    // a missing image is not a failed import
    return null;
  }
}
