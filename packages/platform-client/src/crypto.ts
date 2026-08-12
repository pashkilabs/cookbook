import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import type { SyncTokenSigner, SyncTokenVerifier, TokenPayload } from "./types.js";
import { assembleToken, parseToken, signingInput } from "./token.js";

/**
 * Ed25519 signing and verification. **Server only** — this is the one module that
 * imports node:crypto, which is why it is a separate entry point
 * (`@pashki/platform-client/crypto`) rather than part of the main one. Importing it
 * into an Expo bundle should fail loudly at build time rather than ship a broken
 * polyfill.
 *
 * Asymmetric rather than an HMAC, for one reason that matters as soon as there is a
 * second app: app #2's server can verify tokens the platform issued by holding only
 * a public key. A shared HMAC secret would mean every app that verifies can also
 * mint, and the blast radius of a leak would be every tenant.
 *
 * Keys are addressed by id so rotation is possible: a verifier can hold several
 * public keys while tokens signed by the retired one are still inside their grace
 * window.
 */

export interface Ed25519SignerOptions {
  keyId: string;
  /** PKCS#8 PEM. Never let this reach a client bundle. */
  privateKeyPem: string;
}

export function createEd25519Signer(options: Ed25519SignerOptions): SyncTokenSigner {
  const key = createPrivateKey(options.privateKeyPem);
  assertEd25519(key, "private");

  return {
    sign(payload: TokenPayload): string {
      const signedPart = signingInput(options.keyId, payload);
      const signature = nodeSign(null, Buffer.from(signedPart, "utf8"), key);
      return assembleToken(signedPart, new Uint8Array(signature));
    },
  };
}

export interface Ed25519VerifierOptions {
  /** keyId -> SPKI PEM. More than one entry is how a key rotation completes. */
  publicKeysPem: Record<string, string>;
}

export function createEd25519Verifier(options: Ed25519VerifierOptions): SyncTokenVerifier {
  const keys = new Map<string, KeyObject>();
  for (const [keyId, pem] of Object.entries(options.publicKeysPem)) {
    const key = createPublicKey(pem);
    assertEd25519(key, "public");
    keys.set(keyId, key);
  }
  if (keys.size === 0) throw new Error("a verifier needs at least one public key");

  return {
    verify(token: string): TokenPayload | null {
      const parsed = parseToken(token);
      if (!parsed) return null;

      // An unknown key id is a refusal, not a search: trying every key would let a
      // retired key keep working after it was removed from the map.
      const key = keys.get(parsed.keyId);
      if (!key) return null;

      // Ed25519 signatures are fixed width; a short one cannot be valid and some
      // backends are happier being told so than being handed it.
      if (parsed.signature.length !== 64) return null;

      let ok = false;
      try {
        ok = nodeVerify(null, Buffer.from(parsed.signedPart, "utf8"), key, parsed.signature);
      } catch {
        return null;
      }
      return ok ? parsed.payload : null;
    },
  };
}

/**
 * Generate a key pair. For local development and tests — production keys are
 * created out of band and injected as secrets.
 */
export function generateEd25519KeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/**
 * Refuse anything that is not Ed25519 at construction time.
 *
 * Without this an operator could hand over an RSA key, everything would appear to
 * work, and the token format's promise that signatures are always Ed25519 would
 * quietly stop being true.
 */
function assertEd25519(key: KeyObject, kind: "public" | "private"): void {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `expected an ed25519 ${kind} key, got ${key.asymmetricKeyType ?? "unknown"}`,
    );
  }
}
