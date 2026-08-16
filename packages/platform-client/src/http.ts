import type { Platform, PlatformClient } from "./types.js";

/**
 * The seam's HTTP surface.
 *
 * `platform-client` needs the service role, so it cannot run in a browser or an app
 * bundle (decisions §16). Web can call it server-side; Phase 3's Expo app cannot. These
 * routes are how native reaches the seam, drawn now because retrofitting them with the
 * native app waiting is more expensive than drawing them while nothing depends on them.
 *
 * Framework-agnostic on purpose. The handler works over plain objects so it can be
 * tested without constructing a `Request`, and `toFetchHandler` adapts it to the Fetch
 * API that Next.js route handlers, Deno, Bun and Cloudflare all speak. One
 * implementation, two hosts.
 *
 * **The security property is that there is no `accountId` parameter anywhere.** The
 * account is resolved from the caller's token and handed to `clientFor`; no field in a
 * path, query or body can influence whose data is returned. That is structural rather
 * than validated — there is no code path to close, because there is no code path.
 */

export interface PlatformHttpRequest {
  method: string;
  /** path within the surface, e.g. "/session" — the host strips its own prefix */
  path: string;
  /** the raw Authorization header, if any */
  authorization: string | null;
  /** already-parsed JSON, or undefined */
  body?: unknown;
}

export interface PlatformHttpResponse {
  status: number;
  body: unknown;
}

export type PlatformRouter = (request: PlatformHttpRequest) => Promise<PlatformHttpResponse>;

/**
 * Turns a bearer token into an account id, or null.
 *
 * A port so the tests can stub it. `createSupabaseAuthenticator` asks Supabase Auth to
 * validate the token rather than verifying it locally — which means no component here
 * holds the JWT secret, and a revoked session stops working immediately instead of at
 * expiry.
 */
export interface TokenAuthenticator {
  authenticate(bearerToken: string): Promise<string | null>;
}

export interface PlatformRouterOptions {
  authenticator: TokenAuthenticator;
  /**
   * Builds a client for the authenticated account.
   *
   * The only way an account id enters the seam. A caller cannot reach this.
   */
  clientFor: (accountId: string) => PlatformClient;
}

/** Error codes a caller can branch on, rather than parsing a message. */
export type PlatformErrorCode =
  | "unauthenticated"
  | "not-found"
  | "method-not-allowed"
  | "bad-request"
  | "no-entitlement"
  | "quota-exceeded"
  | "internal";

const fail = (
  status: number,
  code: PlatformErrorCode,
  message: string,
): PlatformHttpResponse => ({ status, body: { error: { code, message } } });

export function createPlatformRouter(options: PlatformRouterOptions): PlatformRouter {
  return async (request: PlatformHttpRequest): Promise<PlatformHttpResponse> => {
    // Authentication first, before the path is even matched. A route that does not
    // exist should not be distinguishable from one a caller may not reach.
    const bearer = readBearer(request.authorization);
    if (!bearer) {
      return fail(401, "unauthenticated", "a bearer token is required");
    }

    let accountId: string | null;
    try {
      accountId = await options.authenticator.authenticate(bearer);
    } catch {
      // an auth server that is down is not the caller's fault, and must not read as
      // "your token is bad"
      return fail(503, "internal", "the token could not be checked");
    }
    if (!accountId) {
      return fail(401, "unauthenticated", "the token is not valid");
    }

    const platform = options.clientFor(accountId);
    const path = normalisePath(request.path);
    const method = request.method.toUpperCase();

    try {
      if (path === "/session") {
        if (method !== "GET") return methodNotAllowed("GET");
        const session = await platform.getSession();
        // the caller's own account, so its email is theirs to see. Other members are
        // display names — nothing here exposes another adult's login.
        return {
          status: 200,
          body: {
            account: { id: session.account.id, email: session.account.email },
            family: {
              id: session.family.id,
              name: session.family.name,
              // the household's units travel with the session: a client that renders a quantity
              // needs them on every screen, and a second round trip per screen is a worse shape
              measurementSystem: session.family.measurementSystem,
            },
            members: session.members.map((member) => ({
              id: member.id,
              displayName: member.displayName,
              colour: member.colour,
              isChild: member.isChild,
            })),
          },
        };
      }

      const entitlementMatch = /^\/entitlement\/([A-Za-z0-9_-]+)$/.exec(path);
      if (entitlementMatch) {
        if (method !== "GET") return methodNotAllowed("GET");
        const appKey = entitlementMatch[1]!;
        const result = await platform.getEntitlement(appKey);
        if (!result) return fail(404, "no-entitlement", `no entitlement for ${appKey}`);

        // The token, not the row. A caller gets the signed artefact it can carry
        // offline plus what it needs to render — never the entitlement record itself,
        // which is platform-owned and would invite clients to reason about it.
        return {
          status: 200,
          body: {
            access: result.access,
            tier: result.entitlement.tier,
            quota: result.entitlement.quota,
            validUntil: result.entitlement.validUntil,
            graceUntil: result.entitlement.graceUntil,
            token: result.token?.token ?? null,
          },
        };
      }

      const quotaMatch = /^\/entitlement\/([A-Za-z0-9_-]+)\/quota$/.exec(path);
      if (quotaMatch) {
        if (method !== "POST") return methodNotAllowed("POST");
        const appKey = quotaMatch[1]!;
        const body = asObject(request.body);
        if (!body) return fail(400, "bad-request", "a JSON body is required");

        const amount = body.amount;
        if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
          return fail(400, "bad-request", "amount must be a positive whole number");
        }
        const quota = typeof body.quota === "string" ? body.quota : undefined;

        // A caller of the existing function, not a second implementation of it. The
        // spend stays one atomic statement in the database.
        const outcome = await platform.consumeQuota(appKey, amount, quota);
        if (outcome.status === "no-entitlement") {
          return fail(404, "no-entitlement", `no entitlement for ${appKey}`);
        }
        if (outcome.status === "exceeded") {
          // 429 rather than 403: the caller may succeed later, when the period rolls
          return { status: 429, body: { error: { code: "quota-exceeded", message: "quota exceeded" }, counter: outcome.counter } };
        }
        return { status: 200, body: { counter: outcome.counter } };
      }

      if (path === "/family/measurement-system") {
        if (method !== "PATCH") return methodNotAllowed("PATCH");
        const body = asObject(request.body);
        if (!body) return fail(400, "bad-request", "a JSON body is required");
        if (body.system !== "us" && body.system !== "metric") {
          return fail(400, "bad-request", "system must be us or metric");
        }
        const family = await platform.setMeasurementSystem(body.system);
        return { status: 200, body: { family } };
      }

      if (path === "/devices") {
        if (method !== "POST") return methodNotAllowed("POST");
        const body = asObject(request.body);
        if (!body) return fail(400, "bad-request", "a JSON body is required");
        if (!isPlatform(body.platform)) {
          return fail(400, "bad-request", "platform must be ios, android or web");
        }
        const deviceId = typeof body.deviceId === "string" ? body.deviceId : undefined;
        const device = await platform.registerDevice(body.platform, deviceId);
        return { status: 200, body: { device } };
      }

      return fail(404, "not-found", `no route for ${method} ${path}`);
    } catch (thrown) {
      // getSession throws for an account with no household — a broken signup, not a
      // request the caller can fix by trying differently
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      if (/belongs to no family|no account for/.test(message)) {
        return fail(409, "bad-request", message);
      }
      return fail(500, "internal", "the request could not be completed");
    }
  };
}

function methodNotAllowed(allowed: string): PlatformHttpResponse {
  return fail(405, "method-not-allowed", `use ${allowed}`);
}

function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/** Trailing slashes and a missing leading slash are the same route. */
function normalisePath(path: string): string {
  const withLeading = path.startsWith("/") ? path : `/${path}`;
  return withLeading.length > 1 ? withLeading.replace(/\/+$/, "") : withLeading;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isPlatform(value: unknown): value is Platform {
  return value === "ios" || value === "android" || value === "web";
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface FetchAdapterOptions {
  /** stripped from the pathname before matching, e.g. "/api/platform" */
  basePath?: string;
}

/**
 * Adapts the router to the Fetch API, which is what a Next.js route handler receives.
 *
 * Thin by design: read the header, parse the body, hand over, serialise. Everything
 * worth testing is in the router, and everything host-specific is here.
 */
export function toFetchHandler(
  router: PlatformRouter,
  options: FetchAdapterOptions = {},
): (request: Request) => Promise<Response> {
  const basePath = options.basePath ?? "";

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = basePath && url.pathname.startsWith(basePath)
      ? url.pathname.slice(basePath.length)
      : url.pathname;

    let body: unknown;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const raw = await request.text();
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          return json(400, { error: { code: "bad-request", message: "body is not JSON" } });
        }
      }
    }

    const response = await router({
      method: request.method,
      path,
      authorization: request.headers.get("authorization"),
      body,
    });

    return json(response.status, response.body);
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // a platform answer is about one account and must never be cached by anything
      // in between
      "cache-control": "no-store",
    },
  });
}
