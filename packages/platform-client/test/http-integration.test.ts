import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "@pashki/db/test-support";
import { createPlatformClient, createPlatformRouter, type PlatformRouter } from "../src/index.js";
import { createSupabaseAuthenticator } from "../src/supabase-auth.js";
import { createSupabasePlatformStore } from "../src/supabase-store.js";
import { createEd25519Signer, createEd25519Verifier, generateEd25519KeyPair } from "../src/crypto.js";

/**
 * The HTTP surface with real Supabase JWTs.
 *
 * The stubbed authenticator proves the router's logic; this proves the thing that
 * actually matters — that a real token resolves to exactly one account, and that a
 * forged one resolves to none. A stub cannot show either, because a stub is the part
 * being trusted.
 */
const instance = readLocalInstance();
const keys = generateEd25519KeyPair();
const signer = createEd25519Signer({ keyId: "k1", privateKeyPem: keys.privateKeyPem });
const verifier = createEd25519Verifier({ publicKeysPem: { k1: keys.publicKeyPem } });

describe.skipIf(instance === null)("platform HTTP surface, real tokens", () => {
  let admin: SupabaseClient;
  let router: PlatformRouter;
  let alpha: TestHousehold;
  let beta: TestHousehold;
  let alphaToken: string;
  let betaToken: string;

  const call = (
    token: string | null,
    over: { method?: string; path?: string; body?: unknown } = {},
  ) =>
    router({
      method: over.method ?? "GET",
      path: over.path ?? "/session",
      authorization: token === null ? null : `Bearer ${token}`,
      ...(over.body === undefined ? {} : { body: over.body }),
    });

  /** The access token a signed-in client would send. */
  const tokenFor = async (household: TestHousehold): Promise<string> => {
    const { data } = await household.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("no session for the household");
    return token;
  };

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    alpha = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "http-alpha",
    });
    beta = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "http-beta",
    });
    alphaToken = await tokenFor(alpha);
    betaToken = await tokenFor(beta);

    const store = createSupabasePlatformStore(admin);
    router = createPlatformRouter({
      // the real authenticator: it asks the auth server rather than verifying locally
      authenticator: createSupabaseAuthenticator(admin),
      clientFor: (accountId) => createPlatformClient({ store, accountId, signer }),
    });
  });

  afterAll(async () => {
    if (!instance) return;
    for (const household of [beta, alpha].filter(Boolean)) {
      await deleteTestHousehold(admin, household);
    }
  });

  describe("a real token", () => {
    it("resolves to its own account and household", async () => {
      const response = await call(alphaToken);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        account: { id: alpha.accountId, email: alpha.email },
        family: { id: alpha.familyId },
      });
    });

    it("returns a verifiable entitlement token", async () => {
      const response = await call(alphaToken, { path: "/entitlement/recipes" });
      expect(response.status).toBe(200);
      const body = response.body as { token: string };
      expect(verifier.verify(body.token)).toMatchObject({
        familyId: alpha.familyId,
        accountId: alpha.accountId,
      });
    });

    it("spends real quota atomically, through the database function", async () => {
      const before = await call(alphaToken, { path: "/entitlement/recipes" });
      const used = (before.body as { quota: { imports: { used: number } } }).quota.imports.used;

      const response = await call(alphaToken, {
        method: "POST",
        path: "/entitlement/recipes/quota",
        body: { amount: 2 },
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ counter: { used: used + 2 } });
    });

    it("registers a device against the token's account", async () => {
      const response = await call(alphaToken, {
        method: "POST",
        path: "/devices",
        body: { platform: "ios" },
      });
      expect(response.status).toBe(200);

      const { data } = await admin
        .from("devices")
        .select("account_id")
        .eq("account_id", alpha.accountId);
      expect(data).toHaveLength(1);
    });
  });

  describe("a token that is not real", () => {
    it("is refused when absent", async () => {
      expect((await call(null)).status).toBe(401);
    });

    it("is refused when it is nonsense", async () => {
      expect((await call("not-a-jwt")).status).toBe(401);
    });

    it("is refused when the signature is wrong", async () => {
      // a real JWT shape with the signature tampered: the auth server checks it, we do not
      const [header, payload, signature = ""] = alphaToken.split(".");
      // regression: this used to flip the signature's **last** character, which is not
      // reliably tampering. A 32-byte HS256 signature is 43 base64url characters and the
      // last one contributes only 4 significant bits, so "A", "B", "C" and "D" all decode
      // to the same bytes — a 4-in-64 chance the forgery was the original token, which
      // read as a post-reset flake for three sessions. The first character carries six
      // bits that all survive, so changing it always changes the signature.
      const forged = `${header}.${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
      expect(
        Buffer.from(forged.split(".")[2] ?? "", "base64url"),
        "the forged signature must decode to different bytes, not merely spell differently",
      ).not.toEqual(Buffer.from(signature, "base64url"));
      expect((await call(forged)).status).toBe(401);
    });

    it("is refused when it names an account that does not exist", async () => {
      // the sub is swapped for another uuid, which invalidates the signature — there is
      // no way to construct a token for an account without the auth server's key
      const [header, , signature] = alphaToken.split(".");
      const swapped = Buffer.from(
        JSON.stringify({ sub: "00000000-0000-0000-0000-000000000000", role: "authenticated" }),
      ).toString("base64url");
      expect((await call(`${header}.${swapped}.${signature}`)).status).toBe(401);
    });
  });

  describe("one token cannot act for another account", () => {
    it("gives each household its own session", async () => {
      const mine = await call(alphaToken);
      const theirs = await call(betaToken);
      expect(mine.body).toMatchObject({ family: { id: alpha.familyId } });
      expect(theirs.body).toMatchObject({ family: { id: beta.familyId } });
    });

    it("spends beta's quota against beta, whatever alpha's body claims", async () => {
      const before = await call(alphaToken, { path: "/entitlement/recipes" });
      const alphaUsed = (before.body as { quota: { imports: { used: number } } }).quota.imports.used;

      // beta's token, naming alpha's household in the body
      const response = await call(betaToken, {
        method: "POST",
        path: "/entitlement/recipes/quota",
        body: { amount: 1, familyId: alpha.familyId, accountId: alpha.accountId },
      });
      expect(response.status).toBe(200);

      const after = await call(alphaToken, { path: "/entitlement/recipes" });
      const alphaAfter = (after.body as { quota: { imports: { used: number } } }).quota.imports.used;
      // untouched: there is no parameter through which beta could reach alpha
      expect(alphaAfter).toBe(alphaUsed);
    });

    it("registers a device against beta, not alpha", async () => {
      await call(betaToken, { method: "POST", path: "/devices", body: { platform: "android" } });
      const { data } = await admin
        .from("devices")
        .select("account_id, platform")
        .eq("account_id", beta.accountId);
      expect(data).toMatchObject([{ platform: "android" }]);
    });
  });
});

describe.skipIf(instance !== null)("platform HTTP surface, real tokens (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
