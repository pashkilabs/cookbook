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
import { extractMicrodata, extractSiteName } from "./microdata.js";
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
 *   3. Fetch the page once, then try each tier against the same HTML.
 *   4. Tier 2, only if the deterministic tiers found nothing and a cascade is
 *      configured. A model is never the first attempt (decisions §6).
 *   5. Fetch and decode the image.
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
      return {
        ok: true,
        recipe: cached.recipe,
        // the tier that originally answered, not a guess: a cache hit that claimed
        // tier 0 would quietly corrupt the hit rate that decides model spend
        tier: cached.tier,
        attempts: [{ tier: cached.tier, outcome: "hit", detail: "from cache" }],
        // the image is not cached: storing it is the photo pipeline's job, and the
        // recipe carries the URL so a caller can fetch it if it wants to
        photo: null,
        fromCache: true,
        urlHash,
      };
    }
  }

  let page;
  try {
    page = await options.fetcher.page(normalised.href);
  } catch (thrown) {
    return {
      ok: false,
      failure: {
        kind: "fetch-failed",
        url: normalised.href,
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
        url: normalised.href,
        detail: `content type ${page.contentType}`,
      },
      attempts,
    };
  }

  const siteName = extractSiteName(page.html) ?? normalised.host;
  let recipe: ExtractedRecipe | null = null;
  let usedTier: Tier | null = null;

  for (const tier of DETERMINISTIC_TIERS) {
    const found = extractTier(tier, page.html, page.finalUrl, normalised.href, siteName);
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
      sourceUrl: normalised.href,
      sourceName: siteName,
      cascade: options.llm,
    });
    attempts.push(...llm.attempts);
    if (llm.recipe && missingFields(llm.recipe).length === 0) {
      recipe = llm.recipe;
      usedTier = "llm";
      // the model is not asked for an image, so take whatever the markup offered
      const fromMarkup = imageFromMarkup(page.html, page.finalUrl, normalised.href, siteName);
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
          url: normalised.href,
          tier: incomplete.tier,
          missing: (incomplete.detail ?? "").split(", ").filter(Boolean),
        },
        attempts,
      };
    }
    return {
      ok: false,
      failure: {
        kind: "no-recipe-found",
        url: normalised.href,
        triedTiers: [...new Set(attempts.map((attempt) => attempt.tier))],
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
    } catch {
      // a cache write failing costs a re-parse next time, which is not worth failing
      // an import the user is watching
    }
  }

  return { ok: true, recipe, attempts, photo, tier: usedTier, fromCache: false, urlHash };
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
  return mapRecipeNode({ node, index, baseUrl, sourceUrl, sourceName });
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
