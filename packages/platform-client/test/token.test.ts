import { describe, expect, it } from "vitest";
import {
  createEd25519Signer,
  createEd25519Verifier,
  generateEd25519KeyPair,
} from "../src/crypto.js";
import { base64UrlDecode, base64UrlEncode, decodeUnverified, parseToken } from "../src/token.js";
import type { TokenPayload } from "../src/types.js";

const keys = generateEd25519KeyPair();
const otherKeys = generateEd25519KeyPair();

const signer = createEd25519Signer({ keyId: "k1", privateKeyPem: keys.privateKeyPem });
const verifier = createEd25519Verifier({ publicKeysPem: { k1: keys.publicKeyPem } });

const payload: TokenPayload = {
  v: 1,
  familyId: "11111111-1111-1111-1111-111111111111",
  accountId: "22222222-2222-2222-2222-222222222222",
  members: [{ id: "m1", displayName: "Ada", isChild: false }],
  entitlements: {
    recipes: { tier: "full", quota: { imports: { limit: 500, used: 160, resetsAt: null } } },
  },
  issuedAt: "2026-08-11T00:00:00.000Z",
  validUntil: "2026-09-11T00:00:00.000Z",
  graceUntil: "2026-09-18T00:00:00.000Z",
};

/** Re-sign a mutated payload with a chosen key, to build a forgery. */
const forge = (changes: Partial<TokenPayload>, privateKeyPem: string, keyId = "k1"): string =>
  createEd25519Signer({ keyId, privateKeyPem }).sign({ ...payload, ...changes });

/** Swap the payload of a valid token without touching its signature. */
const tamper = (token: string, changes: Partial<TokenPayload>): string => {
  const [prefix, keyId, , signature] = token.split(".");
  const swapped = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ ...payload, ...changes })),
  );
  return `${prefix}.${keyId}.${swapped}.${signature}`;
};

describe("round trip", () => {
  it("verifies a token it just signed", () => {
    expect(verifier.verify(signer.sign(payload))).toEqual(payload);
  });

  it("carries display names only — no emails, no ratings", () => {
    const decoded = verifier.verify(signer.sign(payload));
    const asText = JSON.stringify(decoded);
    expect(asText).not.toContain("@");
    for (const member of decoded?.members ?? []) {
      expect(Object.keys(member).sort()).toEqual(["displayName", "id", "isChild"]);
    }
  });

  it("survives base64url values that would break plain base64", () => {
    // '+' and '/' appear in standard base64 and are not URL-safe; the round trip
    // has to be exact for the signature to check out
    const bytes = new Uint8Array([251, 255, 254, 0, 62, 63, 191]);
    expect([...base64UrlDecode(base64UrlEncode(bytes))]).toEqual([...bytes]);
  });
});

describe("tampering", () => {
  it("rejects a payload swapped under a good signature", () => {
    const token = signer.sign(payload);
    expect(verifier.verify(token)).not.toBeNull();
    // the attack that matters: extend your own validity
    expect(verifier.verify(tamper(token, { validUntil: "2099-01-01T00:00:00.000Z" }))).toBeNull();
  });

  it("rejects a quota raised in the payload", () => {
    const token = signer.sign(payload);
    const richer = tamper(token, {
      entitlements: {
        recipes: { tier: "full", quota: { imports: { limit: 999999, used: 0, resetsAt: null } } },
      },
    });
    expect(verifier.verify(richer)).toBeNull();
  });

  it("rejects a token signed by a different key, even with a known key id", () => {
    // the signature is well-formed and the key id is one we know — only the key is
    // wrong, which is the case a naive "try every key" verifier would let through
    expect(verifier.verify(forge({}, otherKeys.privateKeyPem, "k1"))).toBeNull();
  });

  it("rejects an unknown key id rather than searching for a key that fits", () => {
    const rotated = createEd25519Verifier({ publicKeysPem: { k2: otherKeys.publicKeyPem } });
    expect(rotated.verify(signer.sign(payload))).toBeNull();
  });

  it("accepts both keys during a rotation, and neither after", () => {
    const during = createEd25519Verifier({
      publicKeysPem: { k1: keys.publicKeyPem, k2: otherKeys.publicKeyPem },
    });
    expect(during.verify(signer.sign(payload))).not.toBeNull();
    expect(during.verify(forge({}, otherKeys.privateKeyPem, "k2"))).not.toBeNull();

    const after = createEd25519Verifier({ publicKeysPem: { k2: otherKeys.publicKeyPem } });
    expect(after.verify(signer.sign(payload))).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    const good = signer.sign(payload);
    const [prefix, keyId, body, signature] = good.split(".");
    for (const bad of [
      "",
      "nonsense",
      good.slice(0, -4),
      `${good}extra`,
      `${prefix}.${keyId}.${body}`,
      `wrongprefix.${keyId}.${body}.${signature}`,
      `${prefix}..${body}.${signature}`,
      `${prefix}.${keyId}.!!!not-base64!!!.${signature}`,
      `${prefix}.${keyId}.${base64UrlEncode(new TextEncoder().encode("not json"))}.${signature}`,
    ]) {
      expect(() => verifier.verify(bad), JSON.stringify(bad).slice(0, 40)).not.toThrow();
      expect(verifier.verify(bad), JSON.stringify(bad).slice(0, 40)).toBeNull();
    }
  });

  it("rejects a payload missing required claims", () => {
    const truncated = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ v: 1 })));
    const [prefix, keyId, , signature] = signer.sign(payload).split(".");
    expect(verifier.verify(`${prefix}.${keyId}.${truncated}.${signature}`)).toBeNull();
  });

  it("rejects a signature of the wrong length", () => {
    const [prefix, keyId, body] = signer.sign(payload).split(".");
    const short = base64UrlEncode(new Uint8Array(32));
    expect(verifier.verify(`${prefix}.${keyId}.${body}.${short}`)).toBeNull();
  });

  it("cannot be told which algorithm to use", () => {
    // there is no alg field to confuse, which is the point. A payload claiming one
    // changes nothing about how the signature is checked.
    const withAlg = signer.sign({ ...payload, ...({ alg: "none" } as object) } as TokenPayload);
    const parsed = parseToken(withAlg);
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed?.payload)).toContain("none");
    expect(verifier.verify(withAlg)).not.toBeNull(); // still checked with ed25519
  });
});

describe("keys", () => {
  it("refuses a key that is not ed25519", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      createEd25519Signer({
        keyId: "k1",
        privateKeyPem: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      }),
    ).toThrow(/ed25519/);
  });

  it("refuses a verifier with no keys", () => {
    expect(() => createEd25519Verifier({ publicKeysPem: {} })).toThrow(/at least one/);
  });
});

describe("decodeUnverified", () => {
  it("reads a tampered token, which is why it is named that way", () => {
    // legitimate only for offline display. It must NOT be mistaken for verification,
    // so this test pins that it really does return unverified content.
    const forged = tamper(signer.sign(payload), { validUntil: "2099-01-01T00:00:00.000Z" });
    expect(decodeUnverified(forged)?.validUntil).toBe("2099-01-01T00:00:00.000Z");
    expect(verifier.verify(forged)).toBeNull();
  });

  it("still refuses structural nonsense", () => {
    expect(decodeUnverified("nonsense")).toBeNull();
  });
});
