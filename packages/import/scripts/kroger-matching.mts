/**
 * Does a real week's shopping list find products in Kroger's catalogue? (§74)
 *
 * **The number that decides whether the export is worth finishing**, and it costs nothing but a
 * client-credentials token: no user auth, no cart, no order. Run it before anything a person
 * touches, because designing a UI around a matcher that finds half the list is designing the
 * wrong thing.
 *
 * Three outcomes per line, and the middle one is the point:
 *
 *   confident   one product, and our words are all in its description. Safe to propose.
 *   ambiguous   several plausible products. **Not a match** — this project has measured what
 *               happens when a matcher resolves ambiguity by itself (`almond milk` bought whole
 *               milk), and here the mistake costs money rather than a label.
 *   none        nothing came back. Reported, and the household adds it themselves.
 *
 * It also answers the **aisle question**, by printing one full product payload rather than
 * guessing from field names. §73 records that aisle order does not survive the Instacart export;
 * if Kroger returns aisle or location data this *reverses* that, and the export becomes better
 * than the in-app list for shopping in person rather than worse. That changes what the feature
 * is, so it is established before the UI exists.
 *
 * Exits 2 — could not measure — without credentials, a store, or a week. A run that measured
 * nothing must not read like a run that found nothing.
 */
import { readFileSync } from "node:fs";

const id = process.env.KROGER_CLIENT_ID;
const secret = process.env.KROGER_CLIENT_SECRET;
const host = process.env.KROGER_HOST ?? "https://api-ce.kroger.com";
const zip = process.env.KROGER_ZIP ?? "45202";

if (!id || !secret) {
  console.error("COULD NOT MEASURE: KROGER_CLIENT_ID and KROGER_CLIENT_SECRET are not set.");
  console.error("Register at developer.kroger.com, add a product.compact app, and export both.");
  process.exit(2);
}

/*
 * client_credentials only. `cart.basic:write` cannot use this grant and this script must not be
 * able to touch a cart even by accident — the scope is the guard, not the code path.
 */
const tokenResponse = await fetch(`${host}/v1/connect/oauth2/token`, {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
  },
  body: new URLSearchParams({ grant_type: "client_credentials", scope: "product.compact" }),
});
if (!tokenResponse.ok) {
  console.error(`COULD NOT MEASURE: token endpoint answered ${tokenResponse.status} ${await tokenResponse.text()}`);
  process.exit(2);
}
const { access_token: token } = (await tokenResponse.json()) as { access_token: string };

/* Supabase for the catalog, Kroger for the products — two hosts, one helper would conflate them */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const get = async (path: string) => {
  if (path.startsWith("__rest__")) {
    if (!supabaseUrl || !serviceKey) {
      console.error("COULD NOT MEASURE: Supabase url and service role needed for the catalog.");
      process.exit(2);
    }
    const response = await fetch(`${supabaseUrl}/rest/v1/${path.slice("__rest__".length)}`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    });
    if (!response.ok) {
      console.error(`COULD NOT MEASURE: catalog read answered ${response.status}`);
      process.exit(2);
    }
    return response.json() as Promise<any>;
  }
  const response = await fetch(`${host}/v1/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) {
    console.error(`COULD NOT MEASURE: GET /v1/${path} answered ${response.status} ${await response.text()}`);
    process.exit(2);
  }
  return response.json() as Promise<{ data: any[] }>;
};

/* a store is required for product search and pricing, so one is chosen before anything else */
const locations = await get(`locations?filter.zipCode.near=${zip}&filter.limit=1`);
const location = locations.data?.[0];
if (!location) {
  console.error(`COULD NOT MEASURE: no Kroger location near ${zip}.`);
  process.exit(2);
}
console.log(`store ${location.locationId} — ${location.name}, ${location.address?.city}, ${location.address?.state}\n`);

/*
 * The list comes from the real library rather than invented terms. `gen:corpus` writes it, and
 * the catalogue is asked the same words a shopping list would show — the measurement path and
 * the shipping path being the same thing is the lesson from the eval cascade.
 */
let terms: string[];
try {
  const corpus = JSON.parse(readFileSync("/tmp/clean.json", "utf8")) as Array<{
    recipe_ingredients: Array<{ item_text: string }>;
  }>;
  /*
   * The CATALOG's canonical name, falling back to the written words — because that is what §73's
   * design actually sends, and the first run did not.
   *
   * It searched the recipe's own words, so `scallions` found Green Onions and was scored a miss
   * while the catalog has held that alias all along. A measurement of a search term the product
   * would never use is a measurement of nothing — the eval/product divergence again, in a
   * measurement script this time.
   */
  const { createCatalog, isStaple, normaliseName } = await import("../../core/src/index.js");
  const { catalogItemsFromRows, INGREDIENT_COLUMNS, GROCERY_PACKAGE_COLUMNS } =
    await import("../../db/src/catalog.js");
  const catalog = createCatalog(
    catalogItemsFromRows(
      (await get(`__rest__ingredients?select=${INGREDIENT_COLUMNS}`)) as never,
      (await get(`__rest__grocery_packages?select=${GROCERY_PACKAGE_COLUMNS}`)) as never,
      "us",
    ),
  );
  const seen = new Map<string, string>();
  let resolved = 0;
  for (const recipe of corpus) {
    for (const line of recipe.recipe_ingredients ?? []) {
      const text = (line.item_text ?? "").trim();
      if (!text || isStaple(text)) continue;
      const item = catalog.find(text);
      if (item) resolved += 1;
      // the catalog's word when it knows the ingredient, ours when it does not
      const term = item ? item.names[0]! : normaliseName(text) || text;
      if (term && !seen.has(term.toLowerCase())) seen.set(term.toLowerCase(), term);
    }
  }
  console.log(`${resolved} ingredient rows resolved to a catalog item, so their canonical name is searched`);
  terms = [...seen.values()].sort();
} catch {
  console.error("COULD NOT MEASURE: /tmp/clean.json missing — run `pnpm --filter @pashki/import gen:corpus` first.");
  process.exit(2);
}

const SAMPLE = Number(process.env.KROGER_SAMPLE ?? "60");
const sample = terms.filter((_, at) => at % Math.max(1, Math.ceil(terms.length / SAMPLE)) === 0);
console.log(`${terms.length} distinct non-staple ingredient names; asking about ${sample.length}\n`);

/*
 * The first version of this required every significant word of OUR term to appear in theirs, and
 * it was wrong in both directions — which the printed examples caught and the headline number
 * hid.
 *
 * It filed `boneless, skinless chicken thighs` under "nothing found" while Kroger returned
 * `Heritage Farm® Boneless Skinless Chicken Thighs`, because our comma survived the split. It did
 * the same to `bell peper`, a typo in the recipe, against three correct bell peppers. So 4%
 * "confident" was a fact about my matcher, not about the catalogue.
 *
 * And it collapsed two different answers into "ambiguous": `avocados` returning three avocado
 * products is a **choice of brand and size**, which a review screen resolves in one tap, while
 * `bay` returning English muffins is a genuine failure to understand the word. Lumping them gave
 * a number that could not inform the decision it existed for.
 */
const STOP = new Set([
  "boneless", "skinless", "chopped", "diced", "minced", "sliced", "shredded", "grated", "crushed",
  "ground", "peeled", "seeded", "trimmed", "drained", "rinsed", "melted", "softened", "fresh",
  "freshly", "frozen", "dried", "ripe", "large", "small", "medium", "thinly", "finely", "roughly",
  "coarsely", "optional", "divided", "packed", "plus", "about", "each", "more", "piece", "pieces",
  "stalk", "stalks", "bulb", "clove", "cloves", "inch", "pinch", "jar", "can", "bag", "box",
  "oz", "lb", "cup", "cups", "tbsp", "tsp", "ml", "l", "g", "kg", "and", "or", "the", "of",
]);

/** our words, cleaned: punctuation gone, prep and measure words gone, nothing stemmed */
const significant = (term: string) =>
  term
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word));

/**
 * Is this product plausibly the thing we asked for?
 *
 * Every cleaned word of ours must appear in their description — **or its singular form must**,
 * because `avocados` is `Avocado` on a shelf. Nothing is stemmed in the other direction and
 * nothing fuzzy-matches: an extra letter is allowed off the end of our word and that is all.
 */
const plausible = (description: string, words: string[]) => {
  const theirs = description.toLowerCase();
  return words.length > 0 && words.every(
    (word) => theirs.includes(word) || (word.endsWith("s") && theirs.includes(word.slice(0, -1))),
  );
};

/*
 * Four outcomes, because "several right products" and "several wrong products" are different
 * answers and only one of them is a problem.
 *
 *   confident   exactly one plausible product. Propose it.
 *   choice      several, all plausible — brand and size variants. Propose one, and the review
 *               screen is where somebody changes it. NOT a failure.
 *   unmatched   products came back and none is plausibly the thing. The real failure.
 *   none        the catalogue returned nothing at all.
 */
const tally = { confident: 0, choice: 0, unmatched: 0, none: 0, unmeasured: 0 };
const examples: Record<string, string[]> = {
  confident: [], choice: [], unmatched: [], none: [], unmeasured: [],
};

/**
 * A 503 is not a failure to match, and it must not be counted as one.
 *
 * The first run died outright on `PRODUCT-4109-500 Service Unavailable` for one term — and the
 * version before *that* would have filed it under "nothing found", which is a provider hiccup
 * masquerading as a fact about the catalogue. *A skip that infrastructure timing could have
 * caused gets retried before it is believed*, and what survives the retries is reported
 * **apart** from the matching figures rather than folded into them.
 */
const search = async (term: string): Promise<any[] | null> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(
      `${host}/v1/products?filter.term=${encodeURIComponent(term)}&filter.locationId=${location.locationId}&filter.limit=5`,
      { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
    );
    if (response.ok) return ((await response.json()) as { data: any[] }).data ?? [];
    // 4xx is an answer about the request; only 5xx is worth trying again
    if (response.status < 500) return [];
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return null;
};
let firstPayload: unknown = null;
/* the aisle question, counted rather than inferred from one lucky payload */
const aisles = new Map<string, number>();
let aisled = 0;
let withProducts = 0;

for (const term of sample) {
  const products = await search(term);
  if (products === null) {
    tally.unmeasured += 1;
    if (examples.unmeasured!.length < 6) examples.unmeasured!.push(`${term}  →  (503 after four attempts)`);
    continue;
  }
  if (firstPayload === null && products[0]) firstPayload = products[0];
  if (products[0]) {
    withProducts += 1;
    const where = products[0].aisleLocations?.[0]?.description;
    if (where) {
      aisled += 1;
      aisles.set(String(where), (aisles.get(String(where)) ?? 0) + 1);
    }
  }

  const words = significant(term);
  const describing = products.filter((product) => plausible(String(product.description ?? ""), words));
  let verdict: keyof typeof tally;
  if (products.length === 0) verdict = "none";
  else if (describing.length === 1) verdict = "confident";
  else if (describing.length > 1) verdict = "choice";
  else verdict = "unmatched";

  tally[verdict] += 1;
  if (examples[verdict]!.length < 6) {
    examples[verdict]!.push(
      `${term}  →  ${products.slice(0, 3).map((p) => String(p.description ?? "?")).join(" | ") || "(nothing)"}`,
    );
  }
}

/*
 * The denominator excludes what could not be measured. Dividing by the whole sample would quietly
 * deflate every percentage by the provider's bad minute — a smaller number nobody is counting.
 */
const total = sample.length - tally.unmeasured;
if (total === 0) {
  console.error(`COULD NOT MEASURE: all ${sample.length} searches failed with 5xx.`);
  process.exit(2);
}
const pc = (n: number) => `${Math.round((n / total) * 100)}%`;
const usable = tally.confident + tally.choice;
console.log("MATCHING, against the real list:");
console.log(`  confident — one product    ${String(tally.confident).padStart(3)} / ${total}   ${pc(tally.confident)}`);
console.log(`  a choice of variants       ${String(tally.choice).padStart(3)} / ${total}   ${pc(tally.choice)}`);
console.log(`  USABLE (either of those)   ${String(usable).padStart(3)} / ${total}   ${pc(usable)}`);
console.log(`  unmatched — wrong results  ${String(tally.unmatched).padStart(3)} / ${total}   ${pc(tally.unmatched)}`);
console.log(`  nothing came back          ${String(tally.none).padStart(3)} / ${total}   ${pc(tally.none)}`);
console.log(
  tally.unmeasured === 0
    ? `  (every search answered)`
    : `  COULD NOT MEASURE          ${String(tally.unmeasured).padStart(3)} terms — 5xx after four attempts, excluded from the figures above`,
);
for (const [verdict, lines] of Object.entries(examples)) {
  if (lines.length === 0) continue;
  console.log(`\n  ${verdict}:`);
  for (const line of lines) console.log(`    ${line}`);
}

/*
 * The aisle question, answered by printing the shape rather than guessing at field names — the
 * rule that settled a heading-as-ingredient bug in one call after two wrong guesses.
 */
console.log(`\nAISLES: ${aisled} of ${withProducts} products carried aisleLocations`);
for (const [aisle, times] of [...aisles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(times).padStart(3)}×  ${aisle}`);
}

console.log(`\nONE FULL PRODUCT PAYLOAD — does it carry aisle or location data?`);
console.log(JSON.stringify(firstPayload, null, 2)?.slice(0, 2600) ?? "(no product came back)");
