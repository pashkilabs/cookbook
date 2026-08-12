import { describe, expect, it } from "vitest";
import {
  createPlatformClient,
  createPlatformRouter,
  toFetchHandler,
  type Clock,
  type PlatformHttpRequest,
  type PlatformRouter,
  type TokenAuthenticator,
} from "../src/index.js";
import { createEd25519Signer, createEd25519Verifier, generateEd25519KeyPair } from "../src/crypto.js";
import { ACCOUNT_ID, FAMILY_ID, createInMemoryStore, standardSeed } from "./in-memory-store.js";

const keys = generateEd25519KeyPair();
const signer = createEd25519Signer({ keyId: "k1", privateKeyPem: keys.privateKeyPem });
const verifier = createEd25519Verifier({ publicKeysPem: { k1: keys.publicKeyPem } });

const INSIDE = "2026-08-11T00:00:00.000Z";
const clock: Clock = () => new Date(INSIDE);

/** Maps a token to an account, so the tests can forge and withhold tokens freely. */
function stubAuth(tokens: Record<string, string | null>): TokenAuthenticator & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async authenticate(bearer) {
      calls.push(bearer);
      if (bearer === "throws") throw new Error("auth server down");
      return tokens[bearer] ?? null;
    },
  };
}

const OTHER_ACCOUNT = "acc-2";
const OTHER_FAMILY = "fam-2";

/** Two households, so "acting for another account" is a thing that could happen. */
function twoHouseholdStore() {
  const seed = standardSeed();
  return createInMemoryStore({
    accounts: [...(seed.accounts ?? []), { id: OTHER_ACCOUNT, email: "other@example.test" }],
    families: [
      ...(seed.families ?? []),
      { id: OTHER_FAMILY, name: "Other household", ownerAccountId: OTHER_ACCOUNT },
    ],
    members: [
      ...(seed.members ?? []),
      {
        id: "mem-9",
        familyId: OTHER_FAMILY,
        accountId: OTHER_ACCOUNT,
        displayName: "Zed",
        colour: null,
        isChild: false,
      },
    ],
    entitlements: [
      ...(seed.entitlements ?? []),
      {
        familyId: OTHER_FAMILY,
        appKey: "recipes",
        tier: "full",
        quota: { imports: { limit: 10, used: 0, resetsAt: null } },
        validUntil: "2026-09-11T00:00:00.000Z",
        graceUntil: "2026-09-18T00:00:00.000Z",
      },
    ],
  }, clock);
}

function setup(tokens: Record<string, string | null> = { "good-token": ACCOUNT_ID }) {
  const store = twoHouseholdStore();
  const authenticator = stubAuth(tokens);
  const router = createPlatformRouter({
    authenticator,
    clientFor: (accountId) =>
      createPlatformClient({ store, accountId, signer, clock }),
  });
  return { store, authenticator, router };
}

const call = (
  router: PlatformRouter,
  over: Partial<PlatformHttpRequest> = {},
): Promise<{ status: number; body: unknown }> =>
  router({
    method: "GET",
    path: "/session",
    authorization: "Bearer good-token",
    ...over,
  });

describe("authentication", () => {
  it("refuses a request with no token", async () => {
    const { router } = setup();
    const response = await call(router, { authorization: null });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("refuses a token the auth server does not recognise", async () => {
    const { router } = setup();
    const response = await call(router, { authorization: "Bearer forged" });
    expect(response.status).toBe(401);
  });

  it("refuses a header that is not a bearer token", async () => {
    const { router } = setup();
    for (const header of ["good-token", "Basic good-token", "Bearer", "Bearer   "]) {
      const response = await call(router, { authorization: header });
      expect(response.status, header).toBe(401);
    }
  });

  it("checks the token before matching the route, so an unknown path leaks nothing", async () => {
    // a caller without a token should not learn which routes exist
    const { router, authenticator } = setup();
    const response = await call(router, { authorization: null, path: "/does-not-exist" });
    expect(response.status).toBe(401);
    expect(authenticator.calls).toEqual([]);
  });

  it("says the token could not be checked when the auth server fails", async () => {
    // not 401: an outage is not the caller's fault, and telling them their token is bad
    // sends them to re-authenticate for nothing
    const { router } = setup();
    const response = await call(router, { authorization: "Bearer throws" });
    expect(response.status).toBe(503);
  });
});

describe("the account comes from the token and nowhere else", () => {
  it("returns the token holder's own household", async () => {
    const { router } = setup();
    const response = await call(router);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      account: { id: ACCOUNT_ID },
      family: { id: FAMILY_ID },
    });
  });

  it("spends against the token holder's quota, whatever the body claims", async () => {
    // the structural claim: there is no accountId parameter, so these fields cannot be
    // honoured even by accident
    const { store, router } = setup();
    const response = await router({
      method: "POST",
      path: "/entitlement/recipes/quota",
      authorization: "Bearer good-token",
      body: { amount: 3, accountId: OTHER_ACCOUNT, familyId: OTHER_FAMILY },
    });
    expect(response.status).toBe(200);
    expect(store.peekEntitlement(FAMILY_ID, "recipes")?.quota.imports?.used).toBe(3);
    expect(store.peekEntitlement(OTHER_FAMILY, "recipes")?.quota.imports?.used).toBe(0);
  });

  it("gives a second account its own household, not the first one's", async () => {
    const { router } = setup({ "good-token": ACCOUNT_ID, "other-token": OTHER_ACCOUNT });
    const mine = await call(router, { authorization: "Bearer good-token" });
    const theirs = await call(router, { authorization: "Bearer other-token" });
    expect(mine.body).toMatchObject({ family: { id: FAMILY_ID } });
    expect(theirs.body).toMatchObject({ family: { id: OTHER_FAMILY } });
  });

  it("never exposes another adult's email", async () => {
    const { router } = setup();
    const response = await call(router);
    const asText = JSON.stringify(response.body);
    expect(asText).toContain("adult@example.test");
    expect(asText).not.toContain("other@example.test");
  });
});

describe("GET /session", () => {
  it("includes children, who have no login", async () => {
    const { router } = setup();
    const response = await call(router);
    const body = response.body as { members: Array<{ displayName: string; isChild: boolean }> };
    expect(body.members.map((m) => [m.displayName, m.isChild])).toEqual([
      ["Ada", false],
      ["Bo", true],
    ]);
  });

  it("does not leak account ids for other members", async () => {
    const { router } = setup();
    const body = (await call(router)).body as { members: Array<Record<string, unknown>> };
    for (const member of body.members) {
      expect(Object.keys(member).sort()).toEqual(["colour", "displayName", "id", "isChild"]);
    }
  });

  it("refuses a method it does not serve", async () => {
    const { router } = setup();
    const response = await call(router, { method: "POST" });
    expect(response.status).toBe(405);
  });
});

describe("GET /entitlement/:appKey", () => {
  it("returns the signed token, not the entitlement row", async () => {
    const { router } = setup();
    const response = await call(router, { path: "/entitlement/recipes" });
    expect(response.status).toBe(200);

    const body = response.body as Record<string, unknown>;
    expect(verifier.verify(body.token as string)).toMatchObject({ familyId: FAMILY_ID });
    // display fields, and nothing that identifies the record itself
    expect(Object.keys(body).sort()).toEqual([
      "access",
      "graceUntil",
      "quota",
      "tier",
      "token",
      "validUntil",
    ]);
    expect(JSON.stringify(body)).not.toContain("familyId");
  });

  it("reports the access level, so a client knows if it is read-only", async () => {
    const { store } = setup();
    const lapsed = createPlatformRouter({
      authenticator: stubAuth({ "good-token": ACCOUNT_ID }),
      clientFor: (accountId) =>
        createPlatformClient({
          store,
          accountId,
          signer,
          clock: () => new Date("2027-01-01T00:00:00.000Z"),
        }),
    });
    const response = await call(lapsed, { path: "/entitlement/recipes" });
    expect(response.body).toMatchObject({
      access: { level: "read-only", canRead: true, canWrite: false },
    });
  });

  it("404s for an app the household has no entitlement to", async () => {
    const { router } = setup();
    const response = await call(router, { path: "/entitlement/some-other-app" });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: "no-entitlement" } });
  });

  it("does not treat a path that merely starts the same as a match", async () => {
    const { router } = setup();
    for (const path of ["/entitlement", "/entitlement/", "/entitlement/a/b/c"]) {
      const response = await call(router, { path });
      expect(response.status, path).toBe(404);
    }
  });
});

describe("POST /entitlement/:appKey/quota", () => {
  it("spends through the existing function and reports the balance", async () => {
    const { router } = setup();
    const response = await router({
      method: "POST",
      path: "/entitlement/recipes/quota",
      authorization: "Bearer good-token",
      body: { amount: 2 },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ counter: { limit: 10, used: 2, resetsAt: null } });
  });

  it("answers 429 when the allowance is gone, because it may work later", async () => {
    const { router } = setup();
    const body = { amount: 10 };
    await router({ method: "POST", path: "/entitlement/recipes/quota", authorization: "Bearer good-token", body });
    const response = await router({
      method: "POST",
      path: "/entitlement/recipes/quota",
      authorization: "Bearer good-token",
      body: { amount: 1 },
    });
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({
      error: { code: "quota-exceeded" },
      counter: { used: 10 },
    });
  });

  it("refuses a nonsensical amount rather than passing it on", async () => {
    const { router } = setup();
    for (const amount of [0, -1, 1.5, "one", null, undefined]) {
      const response = await router({
        method: "POST",
        path: "/entitlement/recipes/quota",
        authorization: "Bearer good-token",
        body: { amount },
      });
      expect(response.status, String(amount)).toBe(400);
    }
  });

  it("refuses a missing body", async () => {
    const { router } = setup();
    const response = await router({
      method: "POST",
      path: "/entitlement/recipes/quota",
      authorization: "Bearer good-token",
    });
    expect(response.status).toBe(400);
  });
});

describe("POST /devices", () => {
  it("registers a device and returns its id", async () => {
    const { router } = setup();
    const response = await router({
      method: "POST",
      path: "/devices",
      authorization: "Bearer good-token",
      body: { platform: "ios" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ device: { platform: "ios" } });
  });

  it("reuses a known registration", async () => {
    const { store, router } = setup();
    const first = (await router({
      method: "POST",
      path: "/devices",
      authorization: "Bearer good-token",
      body: { platform: "ios" },
    })).body as { device: { id: string } };

    await router({
      method: "POST",
      path: "/devices",
      authorization: "Bearer good-token",
      body: { platform: "ios", deviceId: first.device.id },
    });
    expect(store.devices).toHaveLength(1);
  });

  it("refuses a platform it does not know", async () => {
    const { router } = setup();
    for (const platform of ["windows", "", 7, undefined]) {
      const response = await router({
        method: "POST",
        path: "/devices",
        authorization: "Bearer good-token",
        body: { platform },
      });
      expect(response.status, String(platform)).toBe(400);
    }
  });
});

describe("unknown routes", () => {
  it("404s, once authenticated", async () => {
    const { router } = setup();
    const response = await call(router, { path: "/subscriptions" });
    expect(response.status).toBe(404);
  });
});

describe("the fetch adapter", () => {
  const handler = () => {
    const { router, store } = setup();
    return { handle: toFetchHandler(router, { basePath: "/api/platform" }), store };
  };

  it("serves a Request and returns JSON", async () => {
    const { handle } = handler();
    const response = await handle(
      new Request("https://app.test/api/platform/session", {
        headers: { authorization: "Bearer good-token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ family: { id: FAMILY_ID } });
  });

  it("never lets a platform answer be cached in between", async () => {
    const { handle } = handler();
    const response = await handle(
      new Request("https://app.test/api/platform/session", {
        headers: { authorization: "Bearer good-token" },
      }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("strips the base path before matching", async () => {
    const { handle } = handler();
    const response = await handle(
      new Request("https://app.test/api/platform/entitlement/recipes", {
        headers: { authorization: "Bearer good-token" },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("parses a JSON body and passes it through", async () => {
    const { handle, store } = handler();
    const response = await handle(
      new Request("https://app.test/api/platform/entitlement/recipes/quota", {
        method: "POST",
        headers: { authorization: "Bearer good-token", "content-type": "application/json" },
        body: JSON.stringify({ amount: 4 }),
      }),
    );
    expect(response.status).toBe(200);
    expect(store.peekEntitlement(FAMILY_ID, "recipes")?.quota.imports?.used).toBe(4);
  });

  it("answers 400 for a body that is not JSON, rather than throwing", async () => {
    const { handle } = handler();
    const response = await handle(
      new Request("https://app.test/api/platform/devices", {
        method: "POST",
        headers: { authorization: "Bearer good-token" },
        body: "not json at all",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "bad-request" } });
  });

  it("passes a missing Authorization header through as absent", async () => {
    const { handle } = handler();
    const response = await handle(new Request("https://app.test/api/platform/session"));
    expect(response.status).toBe(401);
  });
});
