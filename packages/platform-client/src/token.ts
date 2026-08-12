import type { TokenPayload } from "./types.js";

/**
 * Token format — parsing and encoding only. No crypto lives here, so this module
 * bundles anywhere, including React Native.
 *
 *   pashki1.<kid>.<payload base64url>.<signature base64url>
 *
 * Two deliberate omissions:
 *
 * **No algorithm field.** A verifier knows it is Ed25519. Letting the token name
 * its own algorithm is how JWT implementations end up accepting `alg: none` or
 * being talked into verifying an RSA signature with an HMAC key. Nothing here
 * negotiates.
 *
 * **No claims the verifier does not need.** The payload is the entitlement and the
 * household, and nothing else — no names beyond display names, no emails, no
 * ratings. Personal data stays in Postgres.
 *
 * The signature covers the exact payload bytes as they appear in the token, not a
 * re-serialisation of the parsed object, so no canonicalisation question arises.
 */

export const TOKEN_PREFIX = "pashki1";

export interface ParsedToken {
  keyId: string;
  /** the exact bytes the signature covers */
  signedPart: string;
  signature: Uint8Array;
  payload: TokenPayload;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The bytes a signer signs: everything before the signature. */
export function signingInput(keyId: string, payload: TokenPayload): string {
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${TOKEN_PREFIX}.${keyId}.${encoded}`;
}

export function assembleToken(signedPart: string, signature: Uint8Array): string {
  return `${signedPart}.${base64UrlEncode(signature)}`;
}

/**
 * Split a token into its parts without checking the signature.
 *
 * Returns null for anything malformed. This is *not* verification — see
 * `decodeUnverified` for when using it is legitimate.
 */
export function parseToken(token: string): ParsedToken | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, keyId, encodedPayload, encodedSignature] = parts;
  if (prefix !== TOKEN_PREFIX || !keyId || !encodedPayload || !encodedSignature) return null;

  let payload: unknown;
  let signature: Uint8Array;
  try {
    payload = JSON.parse(decoder.decode(base64UrlDecode(encodedPayload)));
    signature = base64UrlDecode(encodedSignature);
  } catch {
    return null;
  }
  if (!isTokenPayload(payload)) return null;

  return {
    keyId,
    signedPart: `${prefix}.${keyId}.${encodedPayload}`,
    signature,
    payload,
  };
}

/**
 * Read a token's contents without verifying the signature.
 *
 * Legitimate for exactly one thing: a device rendering its own entitlement while
 * offline — remaining quota, and whether to nag about renewal. It is not a
 * security decision. Every write is authorised by the server against a verified
 * token, and quota is spent server-side, so a device that tampers with its own
 * token gains a misleading display and nothing else.
 *
 * Named to be uncomfortable to call by accident.
 */
export function decodeUnverified(token: string): TokenPayload | null {
  return parseToken(token)?.payload ?? null;
}

function isTokenPayload(value: unknown): value is TokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    typeof candidate.familyId === "string" &&
    typeof candidate.accountId === "string" &&
    Array.isArray(candidate.members) &&
    typeof candidate.entitlements === "object" &&
    candidate.entitlements !== null &&
    typeof candidate.issuedAt === "string" &&
    typeof candidate.validUntil === "string" &&
    typeof candidate.graceUntil === "string"
  );
}
