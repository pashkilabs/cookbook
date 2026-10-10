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

const get = async (path: string) => {
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
  const { createCatalog, isStaple, normaliseName } = await import("../../core/src/index.js");
  void createCatalog;
  const seen = new Set<string>();
  for (const recipe of corpus) {
    for (const line of recipe.recipe_ingredients ?? []) {
      const text = (line.item_text ?? "").trim();
      if (!text || isStaple(text)) continue;
      const key = normaliseName(text) || text;
      if (key) seen.add(key);
    }
  }
  terms = [...seen].sort();
} catch {
  console.error("COULD NOT MEASURE: /tmp/clean.json missing — run `pnpm --filter @pashki/import gen:corpus` first.");
  process.exit(2);
}

const SAMPLE = Number(process.env.KROGER_SAMPLE ?? "60");
const sample = terms.filter((_, at) => at % Math.max(1, Math.ceil(terms.length / SAMPLE)) === 0);
console.log(`${terms.length} distinct non-staple ingredient names; asking about ${sample.length}\n`);

/** every significant word of our term present in their description — stated, not scored */
const describes = (description: string, term: string) => {
  const theirs = description.toLowerCase();
  return term
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((word) => word.length > 2)
    .every((word) => theirs.includes(word));
};

const tally = { confident: 0, ambiguous: 0, none: 0 };
const examples: Record<string, string[]> = { confident: [], ambiguous: [], none: [] };
let firstPayload: unknown = null;

for (const term of sample) {
  const found = await get(
    `products?filter.term=${encodeURIComponent(term)}&filter.locationId=${location.locationId}&filter.limit=5`,
  );
  const products = found.data ?? [];
  if (firstPayload === null && products[0]) firstPayload = products[0];

  const describing = products.filter((product) => describes(String(product.description ?? ""), term));
  let verdict: keyof typeof tally;
  if (products.length === 0) verdict = "none";
  else if (describing.length === 1) verdict = "confident";
  else if (describing.length === 0) verdict = "none";
  else verdict = "ambiguous";

  tally[verdict] += 1;
  if (examples[verdict]!.length < 6) {
    examples[verdict]!.push(
      `${term}  →  ${products.slice(0, 3).map((p) => String(p.description ?? "?")).join(" | ") || "(nothing)"}`,
    );
  }
}

const total = sample.length;
const pc = (n: number) => `${Math.round((n / total) * 100)}%`;
console.log("MATCHING, against the real list:");
console.log(`  confident single product   ${String(tally.confident).padStart(3)} / ${total}   ${pc(tally.confident)}`);
console.log(`  ambiguous — not a match    ${String(tally.ambiguous).padStart(3)} / ${total}   ${pc(tally.ambiguous)}`);
console.log(`  nothing found              ${String(tally.none).padStart(3)} / ${total}   ${pc(tally.none)}`);
for (const [verdict, lines] of Object.entries(examples)) {
  if (lines.length === 0) continue;
  console.log(`\n  ${verdict}:`);
  for (const line of lines) console.log(`    ${line}`);
}

/*
 * The aisle question, answered by printing the shape rather than guessing at field names — the
 * rule that settled a heading-as-ingredient bug in one call after two wrong guesses.
 */
console.log(`\nONE FULL PRODUCT PAYLOAD — does it carry aisle or location data?`);
console.log(JSON.stringify(firstPayload, null, 2)?.slice(0, 2600) ?? "(no product came back)");
