import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readLocalInstance } from "@pashki/db/test-support";
import { createPlatformClient, type PlatformClient } from "../src/index.js";
import { createSupabasePlatformStore } from "../src/supabase-store.js";
import { createEd25519Signer, createEd25519Verifier, generateEd25519KeyPair } from "../src/crypto.js";

/**
 * The Supabase implementation, against a real database.
 *
 * The in-memory store proves the seam is swappable; this proves the real one behaves
 * the same way — and, more importantly, that the quota spend is genuinely atomic.
 * That claim cannot be tested in a fake: a single-threaded stub is atomic for free.
 */
const instance = readLocalInstance();
const keys = generateEd25519KeyPair();
const signer = createEd25519Signer({ keyId: "k1", privateKeyPem: keys.privateKeyPem });
const verifier = createEd25519Verifier({ publicKeysPem: { k1: keys.publicKeyPem } });

describe.skipIf(instance === null)("supabase platform store", () => {
  let admin: SupabaseClient;
  let client: PlatformClient;
  let accountId: string;
  let familyId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const created = await admin.auth.admin.createUser({
      email: `platform-${stamp}@pashki.test`,
      password: `pw-${stamp}`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    accountId = created.data.user!.id;

    const account = await admin
      .from("accounts")
      .insert({ id: accountId, email: `platform-${stamp}@pashki.test` });
    if (account.error) throw account.error;

    const family = await admin
      .from("families")
      .insert({ name: `Household ${stamp}`, owner_account_id: accountId })
      .select("id")
      .single();
    if (family.error) throw family.error;
    familyId = family.data.id;

    // every row spells out every column: in a bulk insert PostgREST sends the union
    // of the keys and passes NULL for whatever a row omits, rather than letting the
    // column default apply
    const members = await admin.from("family_members").insert([
      {
        family_id: familyId,
        account_id: accountId,
        display_name: "Ada",
        colour: "#f00",
        is_child: false,
      },
      {
        family_id: familyId,
        account_id: null,
        display_name: "Bo",
        colour: null,
        is_child: true,
      },
    ]);
    if (members.error) throw members.error;

    const entitlement = await admin.from("entitlements").insert({
      family_id: familyId,
      app_key: "recipes",
      tier: "full",
      quota_json: { imports: { limit: 10, used: 0, resetsAt: null } },
      valid_until: new Date(Date.parse(`${new Date().getFullYear() + 1}-01-01`)).toISOString(),
    });
    if (entitlement.error) throw entitlement.error;

    client = createPlatformClient({
      store: createSupabasePlatformStore(admin),
      accountId,
      signer,
    });
  });

  afterAll(async () => {
    if (!instance || !accountId) return;
    // platform rows are not namespaced the way household data is, and families
    // deliberately RESTRICT deletion of an owning account, so the order matters
    await admin.from("entitlements").delete().eq("family_id", familyId);
    await admin.from("family_members").delete().eq("family_id", familyId);
    await admin.from("devices").delete().eq("account_id", accountId);
    await admin.from("families").delete().eq("id", familyId);
    await admin.from("accounts").delete().eq("id", accountId);
    await admin.auth.admin.deleteUser(accountId);
  });

  it("reads the session out of the real tables", async () => {
    const session = await client.getSession();
    expect(session.account.id).toBe(accountId);
    expect(session.family.id).toBe(familyId);
    expect(session.members.map((m) => m.displayName).sort()).toEqual(["Ada", "Bo"]);
    expect(session.members.find((m) => m.isChild)?.accountId).toBeNull();
  });

  it("reads the entitlement and issues a token that verifies", async () => {
    const result = await client.getEntitlement("recipes");
    expect(result?.access.level).toBe("full");
    expect(result?.entitlement.quota.imports).toEqual({ limit: 10, used: 0, resetsAt: null });
    expect(verifier.verify(result!.token!.token)).toEqual(result!.token!.payload);
  });

  it("spends quota and persists it", async () => {
    const outcome = await client.consumeQuota("recipes", 2);
    expect(outcome).toMatchObject({ status: "allowed", counter: { limit: 10, used: 2 } });

    const { data } = await admin
      .from("entitlements")
      .select("quota_json")
      .eq("family_id", familyId)
      .single();
    expect((data?.quota_json as { imports: { used: number } }).imports.used).toBe(2);
  });

  it("refuses a spend past the limit without partially spending", async () => {
    const outcome = await client.consumeQuota("recipes", 99);
    expect(outcome.status).toBe("exceeded");
    const { data } = await admin
      .from("entitlements")
      .select("quota_json")
      .eq("family_id", familyId)
      .single();
    expect((data?.quota_json as { imports: { used: number } }).imports.used).toBe(2);
  });

  it("spends the remaining balance exactly once under concurrency", async () => {
    // the reason the spend is one conditional UPDATE rather than a read and a
    // write: twenty devices asking at the same instant must not get more than the
    // eight that are left
    await admin
      .from("entitlements")
      .update({ quota_json: { imports: { limit: 10, used: 2, resetsAt: null } } })
      .eq("family_id", familyId);

    const attempts = await Promise.all(
      Array.from({ length: 20 }, () => client.consumeQuota("recipes", 1)),
    );
    const allowed = attempts.filter((a) => a.status === "allowed").length;
    const exceeded = attempts.filter((a) => a.status === "exceeded").length;

    expect(allowed).toBe(8);
    expect(exceeded).toBe(12);

    const { data } = await admin
      .from("entitlements")
      .select("quota_json")
      .eq("family_id", familyId)
      .single();
    expect((data?.quota_json as { imports: { used: number } }).imports.used).toBe(10);
  });

  it("registers a device, then reuses it", async () => {
    const first = await client.registerDevice("ios");
    expect(first.platform).toBe("ios");
    const again = await client.registerDevice("ios", first.id);
    expect(again.id).toBe(first.id);

    const { count } = await admin
      .from("devices")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId);
    expect(count).toBe(1);
  });
});

describe.skipIf(instance !== null)("supabase platform store (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
