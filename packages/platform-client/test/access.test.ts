import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRACE_DAYS,
  authoriseToken,
  evaluateAccess,
  graceUntilFor,
} from "../src/access.js";
import {
  createEd25519Signer,
  createEd25519Verifier,
  generateEd25519KeyPair,
} from "../src/crypto.js";
import type { TokenPayload } from "../src/types.js";

const validUntil = "2026-09-11T00:00:00.000Z";
const graceUntil = "2026-09-18T00:00:00.000Z";
const window = { validUntil, graceUntil };

const at = (iso: string) => evaluateAccess(window, new Date(iso));
const ms = (iso: string, delta: number) => new Date(Date.parse(iso) + delta).toISOString();

describe("the validity window", () => {
  it("is full access well before expiry", () => {
    expect(at("2026-08-11T00:00:00.000Z")).toEqual({
      level: "full",
      canRead: true,
      canWrite: true,
      shouldRenew: false,
    });
  });

  it("is still full at exactly validUntil", () => {
    // valid *until* means the instant itself is included; the other convention
    // expires a subscription a moment early and generates support mail
    expect(at(validUntil).level).toBe("full");
  });

  it("enters grace one millisecond after validUntil", () => {
    expect(at(ms(validUntil, 1)).level).toBe("grace");
  });

  it("keeps writing during grace, and asks to renew", () => {
    expect(at("2026-09-14T00:00:00.000Z")).toEqual({
      level: "grace",
      canRead: true,
      canWrite: true,
      shouldRenew: true,
    });
  });

  it("is still grace at exactly graceUntil", () => {
    expect(at(graceUntil).level).toBe("grace");
  });

  it("degrades one millisecond after graceUntil", () => {
    expect(at(ms(graceUntil, 1)).level).toBe("read-only");
  });
});

describe("after grace", () => {
  it("degrades to read-only, never to locked", () => {
    // decisions §9: a family must not lose access to their own recipes because a
    // card expired mid-shop
    const access = at("2027-01-01T00:00:00.000Z");
    expect(access).toEqual({
      level: "read-only",
      canRead: true,
      canWrite: false,
      shouldRenew: true,
    });
  });

  it("never produces a state that denies reading, at any point on the timeline", () => {
    const probes = [
      "2020-01-01T00:00:00.000Z",
      validUntil,
      ms(validUntil, 1),
      graceUntil,
      ms(graceUntil, 1),
      "2099-01-01T00:00:00.000Z",
    ];
    for (const probe of probes) {
      expect(at(probe).canRead, probe).toBe(true);
    }
  });

  it("fails to read-only rather than to full access on an unparseable window", () => {
    const broken = evaluateAccess({ validUntil: "not a date", graceUntil }, new Date());
    expect(broken.level).toBe("read-only");
    expect(broken.canWrite).toBe(false);
    expect(broken.canRead).toBe(true);
  });
});

describe("graceUntilFor", () => {
  it("adds the grace period to the validity date", () => {
    expect(graceUntilFor(validUntil, 7)).toBe(graceUntil);
  });

  it("defaults to a week", () => {
    expect(graceUntilFor(validUntil, DEFAULT_GRACE_DAYS)).toBe(graceUntil);
  });

  it("refuses a validity date it cannot read rather than inventing one", () => {
    expect(() => graceUntilFor("nonsense", 7)).toThrow(/not a date/);
  });
});

describe("authoriseToken", () => {
  const keys = generateEd25519KeyPair();
  const other = generateEd25519KeyPair();
  const signer = createEd25519Signer({ keyId: "k1", privateKeyPem: keys.privateKeyPem });
  const verifier = createEd25519Verifier({ publicKeysPem: { k1: keys.publicKeyPem } });

  const payload: TokenPayload = {
    v: 1,
    familyId: "fam-1",
    accountId: "acc-1",
    members: [],
    entitlements: { recipes: { tier: "full", quota: {} } },
    issuedAt: "2026-08-11T00:00:00.000Z",
    validUntil,
    graceUntil,
  };
  const token = signer.sign(payload);

  it("pairs the signature check with the window, so a caller cannot forget one", async () => {
    // the gap this closes: verify() alone says nothing about expiry
    expect(verifier.verify(token)).not.toBeNull();
    const authorised = await authoriseToken({ token, verifier, now: new Date(validUntil) });
    expect(authorised).toMatchObject({ status: "active", access: { level: "full" } });
  });

  it("still allows writes during grace", async () => {
    const authorised = await authoriseToken({
      token,
      verifier,
      now: new Date("2026-09-14T00:00:00.000Z"),
    });
    expect(authorised).toMatchObject({ status: "active", access: { level: "grace" } });
  });

  it("degrades to read-only past grace, not to invalid", async () => {
    // a lapsed household still gets its recipes; there is no locked status to return
    const authorised = await authoriseToken({
      token,
      verifier,
      now: new Date(ms(graceUntil, 1)),
    });
    expect(authorised.status).toBe("read-only");
    if (authorised.status === "invalid") throw new Error("unreachable");
    expect(authorised.access).toMatchObject({ canRead: true, canWrite: false });
    expect(authorised.payload.familyId).toBe("fam-1");
  });

  it("reports invalid for a signature that does not check out", async () => {
    const forged = createEd25519Signer({
      keyId: "k1",
      privateKeyPem: other.privateKeyPem,
    }).sign(payload);
    expect(await authoriseToken({ token: forged, verifier })).toEqual({ status: "invalid" });
    expect(await authoriseToken({ token: "nonsense", verifier })).toEqual({ status: "invalid" });
  });

  it("does not let an expired token through by way of a valid signature", async () => {
    // the failure mode in one line: the signature is good and the window is not
    const authorised = await authoriseToken({
      token,
      verifier,
      now: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(authorised.status).not.toBe("active");
  });

  it("never returns a status that denies reading", async () => {
    for (const now of [validUntil, ms(graceUntil, 1), "2099-01-01T00:00:00.000Z"]) {
      const authorised = await authoriseToken({ token, verifier, now: new Date(now) });
      if (authorised.status === "invalid") throw new Error(`unexpected invalid at ${now}`);
      expect(authorised.access.canRead, now).toBe(true);
    }
  });
});
