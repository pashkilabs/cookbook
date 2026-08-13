import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "@pashki/db/test-support";
import { createPlatformClient, type PlatformClient, type PlatformStore } from "../src/index.js";
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
      valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
      grace_until: new Date(Date.now() + 37 * 86400000).toISOString(),
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

  describe("quota period rollover", () => {
    const setCounter = async (counter: Record<string, unknown>) => {
      const { error } = await admin
        .from("entitlements")
        .update({ quota_json: { imports: counter } })
        .eq("family_id", familyId);
      if (error) throw error;
    };

    const readCounter = async () => {
      const { data } = await admin
        .from("entitlements")
        .select("quota_json")
        .eq("family_id", familyId)
        .single();
      return (data?.quota_json as { imports: { used: number; resetsAt: string | null } }).imports;
    };

    it("spends against a fresh balance once the period has elapsed", async () => {
      await setCounter({
        limit: 10,
        used: 10,
        periodDays: 30,
        resetsAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      });
      const outcome = await client.consumeQuota("recipes", 1);
      expect(outcome).toMatchObject({ status: "allowed", counter: { used: 1 } });
      expect(Date.parse((await readCounter()).resetsAt!)).toBeGreaterThan(Date.now());
    });

    it("does not roll over while the period is still running", async () => {
      await setCounter({
        limit: 10,
        used: 10,
        periodDays: 30,
        resetsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      });
      expect((await client.consumeQuota("recipes", 1)).status).toBe("exceeded");
      expect((await readCounter()).used).toBe(10);
    });

    it("rolls over exactly once under concurrent spends across the boundary", async () => {
      // the reason the rollover lives inside the spend: a separate reset job and a
      // spend interleaving here would hand out a second fresh allowance
      await setCounter({
        limit: 8,
        used: 8,
        periodDays: 30,
        resetsAt: new Date(Date.now() - 1000).toISOString(),
      });

      const attempts = await Promise.all(
        Array.from({ length: 20 }, () => client.consumeQuota("recipes", 1)),
      );
      const allowed = attempts.filter((a) => a.status === "allowed").length;

      // exactly one fresh period, spent exactly to its limit
      expect(allowed).toBe(8);
      expect((await readCounter()).used).toBe(8);
      expect(Date.parse((await readCounter()).resetsAt!)).toBeGreaterThan(Date.now());
    });

    it("advances a long gap into the future rather than one period at a time", async () => {
      await setCounter({
        limit: 10,
        used: 10,
        periodDays: 30,
        resetsAt: new Date(Date.now() - 95 * 86400000).toISOString(),
      });
      await client.consumeQuota("recipes", 1);
      expect(Date.parse((await readCounter()).resetsAt!)).toBeGreaterThan(Date.now());
    });
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

  describe("an adult invited into a household they do not own", () => {
    /**
     * The branch that was dead in every test until now: an account owning no
     * household, found through its membership. It is also the one query with a
     * hand-written cast over an embedded resource, so it is the most likely to be
     * quietly wrong.
     */
    let invitedId: string;
    let invitedClient: PlatformClient;

    beforeAll(async () => {
      if (!instance) return;
      const created = await admin.auth.admin.createUser({
        email: `invited-${stamp}@pashki.test`,
        password: `pw-invited-${stamp}`,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      invitedId = created.data.user!.id;

      const account = await admin
        .from("accounts")
        .insert({ id: invitedId, email: `invited-${stamp}@pashki.test` });
      if (account.error) throw account.error;

      // a member of the existing household, and the owner of nothing
      const member = await admin.from("family_members").insert({
        family_id: familyId,
        account_id: invitedId,
        display_name: "Invited",
        colour: null,
        is_child: false,
      });
      if (member.error) throw member.error;

      invitedClient = createPlatformClient({
        store: createSupabasePlatformStore(admin),
        accountId: invitedId,
        signer,
      });
    });

    afterAll(async () => {
      if (!instance || !invitedId) return;
      await admin.from("family_members").delete().eq("account_id", invitedId);
      await admin.from("accounts").delete().eq("id", invitedId);
      await admin.auth.admin.deleteUser(invitedId);
    });

    it("resolves the household through its membership", async () => {
      const session = await invitedClient.getSession();
      expect(session.family.id).toBe(familyId);
      expect(session.account.id).toBe(invitedId);
    });

    it("owns nothing, so the owner is somebody else", async () => {
      const session = await invitedClient.getSession();
      expect(session.family.ownerAccountId).toBe(accountId);
      expect(session.family.ownerAccountId).not.toBe(invitedId);
    });

    it("sees the household's entitlement, not an absence", async () => {
      const result = await invitedClient.getEntitlement("recipes");
      expect(result?.entitlement.familyId).toBe(familyId);
      expect(result?.access.canRead).toBe(true);
    });

    it("returns null when the account is a member of nothing", async () => {
      const orphan = await admin.auth.admin.createUser({
        email: `orphan-${stamp}@pashki.test`,
        password: `pw-orphan-${stamp}`,
        email_confirm: true,
      });
      if (orphan.error) throw orphan.error;
      const orphanId = orphan.data.user!.id;
      await admin.from("accounts").insert({ id: orphanId, email: `orphan-${stamp}@pashki.test` });
      try {
        const client = createPlatformClient({
          store: createSupabasePlatformStore(admin),
          accountId: orphanId,
        });
        await expect(client.getSession()).rejects.toThrow(/belongs to no family/);
      } finally {
        await admin.from("accounts").delete().eq("id", orphanId);
        await admin.auth.admin.deleteUser(orphanId);
      }
    });
  });
});

describe.skipIf(instance !== null)("supabase platform store (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
describe.skipIf(instance === null)("provisioning a household", () => {
  let admin: SupabaseClient;
  let store: PlatformStore;
  const accounts: string[] = [];
  const families: string[] = [];

  beforeAll(() => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    store = createSupabasePlatformStore(admin);
  });

  afterAll(async () => {
    if (!instance) return;
    for (const familyId of families) await admin.from("families").delete().eq("id", familyId);
    for (const accountId of accounts) {
      await admin.from("accounts").delete().eq("id", accountId);
      await admin.auth.admin.deleteUser(accountId);
    }
  });

  /** A real auth user, because accounts.id references auth.users(id). */
  const newSignUp = async (label: string) => {
    const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@pashki.test`;
    const user = await admin.auth.admin.createUser({
      email,
      password: `pw-${label}-${Date.now()}`,
      email_confirm: true,
    });
    if (user.error) throw user.error;
    accounts.push(user.data.user!.id);
    return { accountId: user.data.user!.id, email };
  };

  it("gives a new sign-up an account, a household and a place in it", async () => {
    const { accountId, email } = await newSignUp("provision");
    const result = await store.provisionHousehold({
      accountId,
      email,
      householdName: "The Test Household",
      displayName: "Adult",
    });
    families.push(result.family.id);

    expect(result.created).toBe(true);
    expect(result.account).toEqual({ id: accountId, email });
    expect(result.family).toMatchObject({ name: "The Test Household", ownerAccountId: accountId });
    expect(result.member).toMatchObject({
      familyId: result.family.id,
      accountId,
      displayName: "Adult",
      isChild: false,
    });
  });

  it("returns the same household on a second attempt instead of a second household", async () => {
    // sign-up is a place people double-click and refresh
    const { accountId, email } = await newSignUp("twice");
    const input = {
      accountId,
      email,
      householdName: "First Household",
      displayName: "Adult",
    };
    const first = await store.provisionHousehold(input);
    families.push(first.family.id);

    const second = await store.provisionHousehold({ ...input, householdName: "Second Household" });
    expect(second.created).toBe(false);
    expect(second.family.id).toBe(first.family.id);
    expect(second.family.name).toBe("First Household");
    expect(second.member.id).toBe(first.member.id);

    const { count } = await admin
      .from("families")
      .select("id", { count: "exact", head: true })
      .eq("owner_account_id", accountId);
    expect(count).toBe(1);
  });

  it("completes a household that has no members yet, rather than duplicating it", async () => {
    // the crash window: accounts upserted and families inserted, family_members not.
    // The accounts row has to exist first — families.owner_account_id references it.
    const { accountId, email } = await newSignUp("half");
    const seeded = await admin.from("accounts").insert({ id: accountId, email });
    if (seeded.error) throw seeded.error;

    const orphan = await admin
      .from("families")
      .insert({ name: "Half Built", owner_account_id: accountId })
      .select("id")
      .single();
    if (orphan.error) throw orphan.error;
    families.push(orphan.data.id);

    const result = await store.provisionHousehold({
      accountId,
      email,
      householdName: "Ignored",
      displayName: "Adult",
    });
    expect(result.family.id).toBe(orphan.data.id);
    expect(result.member.accountId).toBe(accountId);

    const { count } = await admin
      .from("families")
      .select("id", { count: "exact", head: true })
      .eq("owner_account_id", accountId);
    expect(count).toBe(1);
  });

  it("issues no entitlement, so a new household reads and cannot write", async () => {
    // decisions §9: absence is not an unmetered allowance, and inventing a trial here
    // would settle the free-tier question that is still open
    const { accountId, email } = await newSignUp("entitle");
    const result = await store.provisionHousehold({
      accountId,
      email,
      householdName: "Unentitled",
      displayName: "Adult",
    });
    families.push(result.family.id);

    expect(await store.findEntitlement(result.family.id, "recipes")).toBeNull();
  });
});

describe.skipIf(instance === null)("issuing an entitlement", () => {
  let admin: SupabaseClient;
  let store: PlatformStore;
  let household: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    store = createSupabasePlatformStore(admin);
    // entitled: false — this suite is about what issuing one changes
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "issue",
      entitled: false,
    });
  });

  afterAll(async () => {
    if (!instance) return;
    if (household) await deleteTestHousehold(admin, household);
  });

  const window = () => ({
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    graceUntil: new Date(Date.now() + 37 * 86400000).toISOString(),
  });

  it("turns a household that cannot write into one that can", async () => {
    // the whole point: household_can_write reads this row, so before and after are
    // different answers to "may I save a recipe"
    const before = await household.client
      .from("recipes")
      .insert({ family_id: household.familyId, title: "Refused" });
    expect(before.error?.code).toBe("42501");

    await store.issueEntitlement({
      familyId: household.familyId,
      appKey: "recipes",
      tier: "full",
      quota: { imports: { limit: 25, used: 0, resetsAt: null } },
      ...window(),
    });

    const after = await household.client
      .from("recipes")
      .insert({ family_id: household.familyId, title: "Accepted" });
    expect(after.error).toBeNull();
  });

  it("updates the window on a second issue rather than duplicating the row", async () => {
    // a replayed billing webhook must not create a second entitlement
    const first = await store.issueEntitlement({
      familyId: household.familyId,
      appKey: "recipes",
      tier: "full",
      quota: { imports: { limit: 25, used: 4, resetsAt: null } },
      ...window(),
    });
    const extended = new Date(Date.now() + 60 * 86400000).toISOString();
    const second = await store.issueEntitlement({
      familyId: household.familyId,
      appKey: "recipes",
      tier: "full",
      quota: { imports: { limit: 50, used: 0, resetsAt: null } },
      validUntil: extended,
      graceUntil: new Date(Date.now() + 67 * 86400000).toISOString(),
    });

    // compared as instants: Postgres returns `+00:00` where the input said `Z`, and every
    // consumer parses rather than string-matches (`evaluateAccess` uses Date.parse)
    expect(Date.parse(first.validUntil)).not.toBe(Date.parse(second.validUntil));
    expect(Date.parse(second.validUntil)).toBe(Date.parse(extended));
    expect(second.quota.imports?.limit).toBe(50);

    const { count } = await admin
      .from("entitlements")
      .select("id", { count: "exact", head: true })
      .eq("family_id", household.familyId);
    expect(count).toBe(1);
  });

  it("reads back through findEntitlement exactly as written", async () => {
    const issued = await store.issueEntitlement({
      familyId: household.familyId,
      appKey: "recipes",
      tier: "full",
      quota: { imports: { limit: 12, used: 3, resetsAt: null, periodDays: 30 } },
      ...window(),
    });
    const read = await store.findEntitlement(household.familyId, "recipes");
    expect(read).toEqual(issued);
  });
});
