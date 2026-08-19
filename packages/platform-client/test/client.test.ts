import { describe, expect, it } from "vitest";
import {
  createPlatformClient,
  decodeUnverified,
  type Clock,
  type Family,
} from "../src/index.js";
import { createEd25519Signer, createEd25519Verifier, generateEd25519KeyPair } from "../src/crypto.js";
import {
  ACCOUNT_ID,
  FAMILY_ID,
  createInMemoryStore,
  standardSeed,
  type Seed,
} from "./in-memory-store.js";

const keys = generateEd25519KeyPair();
const signer = createEd25519Signer({ keyId: "k1", privateKeyPem: keys.privateKeyPem });
const verifier = createEd25519Verifier({ publicKeysPem: { k1: keys.publicKeyPem } });

const fixedClock = (iso: string): Clock => () => new Date(iso);
const INSIDE = "2026-08-11T00:00:00.000Z";

function setup(seed: Seed = standardSeed(), now = INSIDE) {
  // same clock for both: the store decides period rollover, the client decides
  // access level, and a test that gave them different clocks would prove nothing
  const store = createInMemoryStore(seed, fixedClock(now));
  const client = createPlatformClient({
    store,
    accountId: ACCOUNT_ID,
    signer,
    clock: fixedClock(now),
  });
  return { store, client };
}

describe("getSession", () => {
  it("returns the account, its household and every member", async () => {
    const { client } = setup();
    const session = await client.getSession();
    expect(session.account.email).toBe("adult@example.test");
    expect(session.family.id).toBe(FAMILY_ID);
    expect(session.members.map((m) => m.displayName)).toEqual(["Ada", "Bo"]);
  });

  it("includes children, who have no account", async () => {
    const { client } = setup();
    const session = await client.getSession();
    const child = session.members.find((m) => m.isChild);
    expect(child?.accountId).toBeNull();
    expect(child?.displayName).toBe("Bo");
  });

  it("refuses an account with no household rather than inventing one", async () => {
    // every app table is keyed on family_id, so there is nowhere to put data
    const { client } = setup({ accounts: [{ id: ACCOUNT_ID, email: "x@example.test" }] });
    await expect(client.getSession()).rejects.toThrow(/belongs to no family/);
  });

  it("prefers the household the account owns over one it was invited to", async () => {
    const seed = standardSeed();
    const invited: Family = { id: "fam-2", name: "In-laws", ownerAccountId: "other", measurementSystem: "us" };
    const store = createInMemoryStore({
      ...seed,
      families: [invited, ...(seed.families ?? [])],
      members: [
        {
          id: "mem-3",
          familyId: "fam-2",
          accountId: ACCOUNT_ID,
          displayName: "Ada",
          colour: null,
          isChild: false,
          birthYear: null,
        },
        ...(seed.members ?? []),
      ],
    });
    const client = createPlatformClient({ store, accountId: ACCOUNT_ID, clock: fixedClock(INSIDE) });
    expect((await client.getSession()).family.id).toBe(FAMILY_ID);
  });
});

describe("getEntitlement", () => {
  it("reports full access inside the validity window", async () => {
    const { client } = setup();
    const result = await client.getEntitlement("recipes");
    expect(result?.access.level).toBe("full");
    expect(result?.entitlement.tier).toBe("full");
  });

  it("reads the grace window from the row, not from a local policy constant", async () => {
    // the RLS predicate that actually enforces read-only reads this same column;
    // computing it here would give the client and the database two opinions
    const { client } = setup();
    expect((await client.getEntitlement("recipes"))?.entitlement.graceUntil).toBe(
      "2026-09-18T00:00:00.000Z",
    );
  });

  it("honours whatever window the row carries, including an extended one", async () => {
    const seed = standardSeed();
    const store = createInMemoryStore({
      ...seed,
      entitlements: [{ ...seed.entitlements![0]!, graceUntil: "2026-10-11T00:00:00.000Z" }],
    });
    const client = createPlatformClient({ store, accountId: ACCOUNT_ID, clock: fixedClock(INSIDE) });
    expect((await client.getEntitlement("recipes"))?.entitlement.graceUntil).toBe(
      "2026-10-11T00:00:00.000Z",
    );
  });

  it("degrades to read-only after grace, and still reports the entitlement", async () => {
    const { client } = setup(standardSeed(), "2027-01-01T00:00:00.000Z");
    const result = await client.getEntitlement("recipes");
    expect(result?.access).toMatchObject({ level: "read-only", canRead: true, canWrite: false });
    // the family can still see what they own
    expect(result?.entitlement.familyId).toBe(FAMILY_ID);
  });

  it("issues a token that verifies", async () => {
    const { client } = setup();
    const result = await client.getEntitlement("recipes");
    expect(result?.token).toBeDefined();
    expect(verifier.verify(result!.token!.token)).toEqual(result!.token!.payload);
  });

  it("issues no token when no signer is configured", async () => {
    const store = createInMemoryStore(standardSeed());
    const client = createPlatformClient({ store, accountId: ACCOUNT_ID, clock: fixedClock(INSIDE) });
    expect((await client.getEntitlement("recipes"))?.token).toBeUndefined();
  });

  it("returns null for an app the household has no entitlement to", async () => {
    const { client } = setup();
    expect(await client.getEntitlement("some-other-app")).toBeNull();
  });

  it("keys entitlements by app, so a second app is a row not a column", async () => {
    const seed = standardSeed();
    const store = createInMemoryStore({
      ...seed,
      entitlements: [
        ...(seed.entitlements ?? []),
        {
          familyId: FAMILY_ID,
          appKey: "app-two",
          tier: "full",
          quota: { things: { limit: 3, used: 0, resetsAt: null } },
          validUntil: "2026-09-11T00:00:00.000Z",
          graceUntil: "2026-09-18T00:00:00.000Z",
        },
      ],
    });
    const client = createPlatformClient({ store, accountId: ACCOUNT_ID, clock: fixedClock(INSIDE) });
    expect((await client.getEntitlement("app-two"))?.entitlement.quota.things?.limit).toBe(3);
    expect((await client.getEntitlement("recipes"))?.entitlement.quota.imports?.limit).toBe(10);
  });
});

describe("consumeQuota", () => {
  it("allows a spend within the limit and reports the new balance", async () => {
    const { client } = setup();
    const outcome = await client.consumeQuota("recipes", 3);
    expect(outcome).toEqual({ status: "allowed", counter: { limit: 10, used: 3, resetsAt: null } });
  });

  it("accumulates across calls", async () => {
    const { client } = setup();
    await client.consumeQuota("recipes", 4);
    const second = await client.consumeQuota("recipes", 4);
    expect(second).toMatchObject({ status: "allowed", counter: { used: 8 } });
  });

  it("refuses a spend that would exceed the limit, and does not partially spend", async () => {
    const { client, store } = setup(standardSeed({ imports: { limit: 10, used: 9, resetsAt: null } }));
    const outcome = await client.consumeQuota("recipes", 2);
    expect(outcome.status).toBe("exceeded");
    // the refusal has to leave the counter alone — a partial spend would be worse
    // than either outcome
    expect(store.peekEntitlement(FAMILY_ID, "recipes")?.quota.imports?.used).toBe(9);
  });

  it("reports the counter when refusing, so the app can explain why", async () => {
    const { client } = setup(standardSeed({ imports: { limit: 10, used: 10, resetsAt: "2026-09-01T00:00:00.000Z" } }));
    const outcome = await client.consumeQuota("recipes", 1);
    expect(outcome).toEqual({
      status: "exceeded",
      counter: { limit: 10, used: 10, resetsAt: "2026-09-01T00:00:00.000Z" },
    });
  });

  it("allows a spend that lands exactly on the limit", async () => {
    const { client } = setup(standardSeed({ imports: { limit: 10, used: 8, resetsAt: null } }));
    expect((await client.consumeQuota("recipes", 2)).status).toBe("allowed");
  });

  it("refuses a counter the entitlement does not carry rather than assuming no limit", async () => {
    const { client } = setup();
    expect((await client.consumeQuota("recipes", 1, "unmetered")).status).toBe("exceeded");
  });

  it("reports no entitlement rather than allowing an unmetered spend", async () => {
    const { client } = setup();
    expect(await client.consumeQuota("nonexistent-app", 1)).toEqual({ status: "no-entitlement" });
  });

  it("rejects a nonsensical amount", async () => {
    const { client } = setup();
    for (const amount of [0, -1, 1.5, Number.NaN]) {
      await expect(client.consumeQuota("recipes", amount)).rejects.toThrow(/positive whole/);
    }
  });

  it("is the only thing that moves the balance — the token's copy is a snapshot", async () => {
    const { client } = setup();
    const before = await client.getEntitlement("recipes");
    const snapshot = decodeUnverified(before!.token!.token);
    expect(snapshot?.entitlements.recipes?.quota.imports?.used).toBe(0);

    await client.consumeQuota("recipes", 5);

    // the token a device is already holding still says 0: it is for display, and
    // spending it was a server call
    expect(decodeUnverified(before!.token!.token)?.entitlements.recipes?.quota.imports?.used).toBe(0);
    // a freshly issued one reflects the spend
    const after = await client.getEntitlement("recipes");
    expect(after!.token!.payload.entitlements.recipes?.quota.imports?.used).toBe(5);
  });

  it("still refuses when the device's stale token claims plenty remaining", async () => {
    // the offline-then-online case: the device believed it had 10 left
    const { client } = setup(standardSeed({ imports: { limit: 10, used: 0, resetsAt: null } }));
    const optimistic = await client.getEntitlement("recipes");
    expect(optimistic!.token!.payload.entitlements.recipes?.quota.imports?.used).toBe(0);
    await client.consumeQuota("recipes", 10);
    expect((await client.consumeQuota("recipes", 1)).status).toBe("exceeded");
  });
});

describe("registerDevice", () => {
  it("registers a device and returns its id", async () => {
    const { client } = setup();
    const device = await client.registerDevice("ios");
    expect(device.id).toBeTruthy();
    expect(device.platform).toBe("ios");
  });

  it("reuses a known registration instead of adding a row per sign-in", async () => {
    const { client, store } = setup();
    const first = await client.registerDevice("ios");
    const again = await client.registerDevice("ios", first.id);
    expect(again.id).toBe(first.id);
    expect(store.devices).toHaveLength(1);
  });

  it("registers afresh when the id is unknown", async () => {
    const { client, store } = setup();
    await client.registerDevice("web", "not-a-device");
    expect(store.devices).toHaveLength(1);
  });
});

describe("quota period rollover", () => {
  const period = (used: number, resetsAt: string, periodDays?: number) =>
    standardSeed({
      imports: { limit: 10, used, resetsAt, ...(periodDays === undefined ? {} : { periodDays }) },
    });

  it("spends against a fresh balance once the period has elapsed", async () => {
    // §8 is defeated entirely if a monthly allowance is really a lifetime one
    const { client } = setup(period(10, "2026-08-01T00:00:00.000Z", 30), INSIDE);
    const outcome = await client.consumeQuota("recipes", 1);
    expect(outcome).toMatchObject({ status: "allowed", counter: { used: 1 } });
  });

  it("advances the deadline into the future rather than by one period", async () => {
    // three months of not importing must not leave three resets owing
    const { client, store } = setup(period(10, "2026-05-01T00:00:00.000Z", 30), INSIDE);
    await client.consumeQuota("recipes", 1);
    const resets = store.peekEntitlement(FAMILY_ID, "recipes")?.quota.imports?.resetsAt;
    expect(Date.parse(resets!)).toBeGreaterThan(Date.parse(INSIDE));
  });

  it("does not roll over while the period is still running", async () => {
    const { client } = setup(period(10, "2026-09-01T00:00:00.000Z", 30), INSIDE);
    expect((await client.consumeQuota("recipes", 1)).status).toBe("exceeded");
  });

  it("rolls over exactly once, not on every spend", async () => {
    const { client, store } = setup(period(10, "2026-08-01T00:00:00.000Z", 30), INSIDE);
    await client.consumeQuota("recipes", 4);
    await client.consumeQuota("recipes", 4);
    expect(store.peekEntitlement(FAMILY_ID, "recipes")?.quota.imports?.used).toBe(8);
  });

  it("treats a one-off allowance as renewing once and then never", async () => {
    const { client, store } = setup(period(10, "2026-08-01T00:00:00.000Z"), INSIDE);
    expect((await client.consumeQuota("recipes", 10)).status).toBe("allowed");
    expect(store.peekEntitlement(FAMILY_ID, "recipes")?.quota.imports?.resetsAt).toBeNull();
    // and with no deadline left there is nothing to roll over
    expect((await client.consumeQuota("recipes", 1)).status).toBe("exceeded");
  });

  it("leaves a counter with no deadline alone", async () => {
    const { client } = setup(standardSeed({ imports: { limit: 10, used: 10, resetsAt: null } }));
    expect((await client.consumeQuota("recipes", 1)).status).toBe("exceeded");
  });
});

describe("a child's year of birth", () => {
  /*
   * The boundary is the **token**, not getSession.
   *
   * getSession is the seam's own server-side API and returns whole members by design. What
   * crosses HTTP is the token payload, whose standing rule is that a leak must not become a
   * privacy incident — "display names only. No emails, no ratings." A child's year of birth is
   * exactly what that sentence is about.
   */
  it("never reaches the token, which is the thing that leaves the server", async () => {
    const { client } = setup();
    const result = await client.getEntitlement("recipes");
    const payload = decodeUnverified(result!.token!.token);
    expect(payload?.members.length).toBeGreaterThan(0);
    for (const member of payload!.members) {
      expect(member).not.toHaveProperty("birthYear");
    }
  });

  it("is there for a server-side caller that asks the seam directly", async () => {
    const { client } = setup();
    const session = await client.getSession();
    const child = session.members.find((member) => member.isChild);
    expect(child?.birthYear).toBe(2018);
  });
});
