import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens.
 *
 * **The token is never stored.** `invitations.token_hash` holds a SHA-256 and nothing else, so a
 * leaked backup or a support query over that table yields hashes — and a hash cannot be presented
 * to `accept_invitation`. The token itself exists in the email and in the URL the invited person
 * clicks, and nowhere in our infrastructure.
 *
 * 32 bytes of `randomBytes`, base64url. That is 256 bits: not guessable, and short enough to
 * survive being pasted out of an email client that has decided to wrap the line.
 *
 * No pepper and no HMAC, deliberately. A pepper protects a *low-entropy* secret from an offline
 * attack — a password. Against 256 random bits, SHA-256 with no salt is already unattackable, and
 * a pepper would add a key to rotate and lose for no gain.
 */
export const INVITATION_TOKEN_BYTES = 32;

/** Seven days. Long enough to survive a weekend and a spam folder, short enough to expire. */
export const INVITATION_TTL_DAYS = 7;

export interface MintedInvitationToken {
  /** goes in the email, and nowhere else */
  token: string;
  /** goes in the database, and nowhere else */
  tokenHash: string;
}

export function mintInvitationToken(): MintedInvitationToken {
  const token = randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export const hashInvitationToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Compare two hashes without leaking how far they matched.
 *
 * The database does the real comparison in a WHERE clause, so this is for the few places that
 * check in application code. Constant-time regardless, because a comparison that is sometimes
 * timing-safe is a comparison nobody can reason about.
 */
export function invitationHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** An address, folded the one way everything folds it. */
export const normaliseInvitedAddress = (email: string): string => email.trim().toLowerCase();

export const invitationExpiry = (from: Date = new Date(), days = INVITATION_TTL_DAYS): string =>
  new Date(from.getTime() + days * 86_400_000).toISOString();

export type InvitationState =
  | "pending"
  | "accepted"
  | "revoked"
  | "superseded"
  | "expired";

/**
 * What an invitation is, derived rather than stored.
 *
 * A `status` column would be a second thing to keep in step with the timestamps that already say
 * everything — and the SQL that accepts an invitation matches on those timestamps, so a column
 * could disagree with the row that governs it.
 */
export function invitationState(
  invitation: {
    acceptedAt: string | null;
    revokedAt: string | null;
    supersededAt: string | null;
    expiresAt: string;
  },
  now: Date = new Date(),
): InvitationState {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (invitation.supersededAt) return "superseded";
  if (Date.parse(invitation.expiresAt) <= now.getTime()) return "expired";
  return "pending";
}
