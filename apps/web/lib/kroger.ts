/**
 * Talking to Kroger (§74, §75). **Server only** — this file holds a client secret.
 *
 * ---------------------------------------------------------------------------
 * Two environments, and which one is in use is never inferred
 * ---------------------------------------------------------------------------
 *
 * A certification cart is not a production cart, and a CE key does not work against production —
 * verified, not assumed: the production key answers `invalid credentials` at `api-ce`. So the
 * environment picks **both** the host and the credential pair, together, and `/api/health` reports
 * which one is live. *A shared secret set on both sides can still be two different secrets*, and
 * here the two sides are two environments.
 *
 * Certification is the default. The only operation that spends money is the cart write, and a
 * default that reaches production would make the dangerous case the easy one.
 *
 * ---------------------------------------------------------------------------
 * No token is stored, anywhere
 * ---------------------------------------------------------------------------
 *
 * `cart.basic:write` cannot use `client_credentials` — their own error says so — so a cart write
 * needs a person to authorise. The access token that comes back lives 30 minutes and is used
 * within seconds, then dropped. Nothing persists it (§74): a refresh token lives six months and
 * places orders on somebody's account, and what it would buy is unattended use, which this
 * project already forbids.
 */
import { foldForSearch, searchBranches } from "@pashki/core";

export type KrogerEnvironment = "certification" | "production";

export interface KrogerConfig {
  environment: KrogerEnvironment;
  host: string;
  clientId: string;
  clientSecret: string;
}

const HOSTS: Record<KrogerEnvironment, string> = {
  certification: "https://api-ce.kroger.com",
  production: "https://api.kroger.com",
};

/**
 * The configured environment, or null when it is not configured at all.
 *
 * Returns null rather than throwing so a screen can offer nothing instead of erroring — the same
 * reasoning that makes `cascadeFromEnv` return null when inference is unconfigured.
 */
export function krogerConfig(env: NodeJS.ProcessEnv = process.env): KrogerConfig | null {
  const environment: KrogerEnvironment =
    env.KROGER_ENV === "production" ? "production" : "certification";
  const clientId = environment === "production" ? env.KROGER_CLIENT_ID : env.KROGER_CE_CLIENT_ID;
  const clientSecret =
    environment === "production" ? env.KROGER_CLIENT_SECRET : env.KROGER_CE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { environment, host: HOSTS[environment], clientId, clientSecret };
}

/** 12 hex of SHA-256 — enough to compare two copies, never enough to use one */
export async function krogerKeyFingerprint(config: KrogerConfig | null): Promise<string | null> {
  if (!config) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${config.clientId}:${config.clientSecret}`),
  );
  return Array.from(new Uint8Array(digest)).slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const basic = (config: KrogerConfig) =>
  `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;

/** an app token, for searching products. Never for a cart — their API refuses that outright. */
export async function appToken(config: KrogerConfig): Promise<string | null> {
  const response = await fetch(`${config.host}/v1/connect/oauth2/token`, {
    method: "POST",
    headers: { authorization: basic(config), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "product.compact" }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { access_token?: string };
  return body.access_token ?? null;
}

/**
 * Categories that are not food, so a grocery line must never resolve to one.
 *
 * Found on the real list, not theorised: `sesame oil` matched **Neutrogena Light Sesame Formula
 * Body Oil** at $13.99 and `coconut oil` matched **Banana Boat Deep Tanning Dry Oil** — both
 * ranked first, both carrying a price and an aisle, both about to be proposed as groceries. §75
 * said a substring matcher produces its false confidence where it claims to be sure; this is what
 * that costs when money is attached.
 *
 * `categories` was in the response the whole time. Filtering `Beauty` also **promotes the right
 * product**: `Nutiva Organic Virgin Coconut Oil` was second behind the sun cream.
 *
 * A deny-list and not an allow-list, deliberately, and the reasoning is the opposite of
 * `isStaple`'s. There, a missed entry failed invisibly, so an allow-list was safer. Here the
 * residue is **shown** — every proposal carries its categories to the review screen — so a
 * category this list has not heard of arrives in front of a person rather than slipping past.
 * The filter improves the default; the review catches what it missed.
 */
const NON_FOOD = new Set([
  "beauty", "personal care", "health", "home decor", "household essentials", "cleaning products",
  "baby", "pet care", "pets", "office, school, & crafts", "hardware", "apparel", "toys",
  "electronics", "garden & patio", "automotive", "sports & outdoors", "tobacco",
]);

export interface KrogerProduct {
  upc: string;
  description: string;
  /** the aisle in THIS store, which is what §75 found and §73 does not get */
  aisle: string | null;
  size: string | null;
  priceCents: number | null;
  /** theirs, verbatim, so a review screen can show what a filter could not judge */
  categories: string[];
}

const asProduct = (raw: any): KrogerProduct => {
  const item = raw?.items?.[0];
  const price = item?.price?.promo || item?.price?.regular || null;
  return {
    upc: String(raw?.upc ?? ""),
    description: String(raw?.description ?? ""),
    aisle: raw?.aisleLocations?.[0]?.description ?? null,
    size: item?.size ?? null,
    priceCents: typeof price === "number" ? Math.round(price * 100) : null,
    categories: Array.isArray(raw?.categories) ? raw.categories.map(String) : [],
  };
};

/** every category is non-food — not "some", because a thing can be in two aisles */
const isNonFood = (product: KrogerProduct) =>
  product.categories.length > 0 &&
  product.categories.every((category) => NON_FOOD.has(category.toLowerCase()));

/**
 * Candidate products for one ingredient name.
 *
 * **Branches, then folding** — the two things §75 and §76 established. A name offering a choice is
 * tried branch by branch, because no product is both honey and agave syrup, and the recipe's order
 * is its preference so the first branch to return anything wins. Each branch is folded, because a
 * shelf says `Jalapeno`.
 *
 * Returns everything it found. **It does not pick.** §75 measured that the single-match bucket
 * contained parmesan returned for red pepper flakes, with the correct products in the same result
 * set — so there is no confidence tier and nothing here may choose on a household's behalf.
 */
export async function findProducts(
  config: KrogerConfig,
  token: string,
  /**
   * **The catalog's canonical name**, falling back to what the recipe wrote.
   *
   * §75 recorded this and the first version of the propose route broke it anyway: searching
   * `spring onions` finds nothing while the catalog's `green onion` finds the product, because the
   * alias has been there all along. Passing the label is a measurement — and now a *feature* — of
   * a search term the product would never use.
   */
  name: string,
  locationId: string,
): Promise<{ branch: string; products: KrogerProduct[] } | null> {
  for (const branch of searchBranches(name)) {
    const query = new URLSearchParams({
      "filter.term": foldForSearch(branch),
      "filter.locationId": locationId,
      "filter.limit": "5",
    });
    const response = await fetch(`${config.host}/v1/products?${query}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
    });
    // 5xx is the provider, not an answer about the ingredient; the caller decides whether to retry
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: any[] };
    const all = (body.data ?? []).map(asProduct).filter((product) => product.upc);
    // non-food dropped rather than demoted: a grocery line resolving to sun cream is not a
    // ranking problem, and leaving it in the list invites the tap it exists to prevent
    const products = all.filter((product) => !isNonFood(product));
    if (products.length > 0) return { branch, products };
  }
  return { branch: name, products: [] };
}

export interface CartItem {
  upc: string;
  quantity: number;
}

export interface CartWriteResult {
  status: number;
  /** their body, kept verbatim: "no answer" and "an answer we did not like" are different */
  body: string;
  ok: boolean;
}

/**
 * Add items to the signed-in person's cart. **Add-only, and unreadable afterwards.**
 *
 * Confirmed by probe rather than assumed: `PUT /v1/cart/add` answers, `POST` to it 404s, and
 * `/v1/cart` is not a route at all. So there is no way to check what landed, no way to correct it,
 * and a second send doubles the order — which is why the caller records its intent *before*
 * calling this and treats an unknown outcome as sent.
 */
export async function addToCart(
  config: KrogerConfig,
  userToken: string,
  items: readonly CartItem[],
  modality: "PICKUP" | "DELIVERY" = "PICKUP",
): Promise<CartWriteResult> {
  const response = await fetch(`${config.host}/v1/cart/add`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${userToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ items: items.map((item) => ({ ...item, modality })) }),
    cache: "no-store",
  });
  return { status: response.status, body: (await response.text()).slice(0, 400), ok: response.ok };
}

/** where a person goes to authorise, and the only place `cart.basic:write` can come from */
export function authorizeUrl(config: KrogerConfig, redirectUri: string, state: string): string {
  const query = new URLSearchParams({
    scope: "cart.basic:write",
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${config.host}/v1/connect/oauth2/authorize?${query}`;
}

/** exchange the code for a user token. Used immediately and never written down. */
export async function userToken(
  config: KrogerConfig,
  code: string,
  redirectUri: string,
): Promise<string | null> {
  const response = await fetch(`${config.host}/v1/connect/oauth2/token`, {
    method: "POST",
    headers: { authorization: basic(config), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { access_token?: string };
  return body.access_token ?? null;
}
