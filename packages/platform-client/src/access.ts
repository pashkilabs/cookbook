import type { Access, Clock, TokenPayload } from "./types.js";

/**
 * What the app may do, given a validity window and the time.
 *
 * The whole point of decisions §9 lives in this function: after grace expires the
 * app degrades to **read-only, not locked**. A family should never lose access to
 * their own recipes because a card expired mid-shop.
 *
 * Boundaries are inclusive of the deadline — a token is valid *until* validUntil,
 * so at exactly that instant it is still valid. Same for grace. Picking the other
 * convention would mean a token bought to the second expires a moment early, which
 * is the sort of thing that produces one support email a week.
 */
export const DEFAULT_GRACE_DAYS = 7;

export function evaluateAccess(
  window: Pick<TokenPayload, "validUntil" | "graceUntil">,
  now: Date,
): Access {
  const at = now.getTime();
  const validUntil = Date.parse(window.validUntil);
  const graceUntil = Date.parse(window.graceUntil);

  // An unparseable window is treated as expired rather than as full access: fail
  // to the degraded state, never to the permissive one. Read-only still lets the
  // family cook from what they already have.
  if (!Number.isFinite(validUntil) || !Number.isFinite(graceUntil)) {
    return { level: "read-only", canRead: true, canWrite: false, shouldRenew: true };
  }

  if (at <= validUntil) {
    return { level: "full", canRead: true, canWrite: true, shouldRenew: false };
  }
  if (at <= graceUntil) {
    return { level: "grace", canRead: true, canWrite: true, shouldRenew: true };
  }
  return { level: "read-only", canRead: true, canWrite: false, shouldRenew: true };
}

export function graceUntilFor(validUntil: string, graceDays: number): string {
  const base = Date.parse(validUntil);
  if (!Number.isFinite(base)) throw new Error(`validUntil is not a date: ${validUntil}`);
  return new Date(base + graceDays * 24 * 60 * 60 * 1000).toISOString();
}

export const systemClock: Clock = () => new Date();
