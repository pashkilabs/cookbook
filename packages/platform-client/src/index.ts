/**
 * @pashki/platform-client — the seam.
 *
 * App code asks this package about accounts, households, entitlements and quota,
 * and never queries the platform tables itself. Get that boundary right and
 * extracting a real platform for app #2 is mechanical; get it wrong and it is
 * surgical.
 *
 * This entry point deliberately imports no crypto and no database driver, so it is
 * safe to bundle for React Native. The pieces that need them are separate:
 *
 *   @pashki/platform-client/crypto     Ed25519 signing — server only
 *   @pashki/platform-client/supabase   the Supabase PlatformStore — server only
 */
export * from "./types.js";
export { createPlatformClient, DEFAULT_QUOTA } from "./client.js";
export { DEFAULT_GRACE_DAYS, evaluateAccess, graceUntilFor, systemClock } from "./access.js";
export {
  TOKEN_PREFIX,
  assembleToken,
  base64UrlDecode,
  base64UrlEncode,
  decodeUnverified,
  parseToken,
  signingInput,
  type ParsedToken,
} from "./token.js";

/**
 * The platform tables. Exported so the import guard and any future lint rule have
 * one list to check against rather than a hardcoded copy.
 */
export const PLATFORM_TABLES = [
  "accounts",
  "families",
  "family_members",
  "devices",
  "subscriptions",
  "entitlements",
] as const;

export type PlatformTable = (typeof PLATFORM_TABLES)[number];
