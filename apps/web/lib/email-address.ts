/**
 * An address as it should be stored and looked up — trimmed, and lower-cased.
 *
 * ---------------------------------------------------------------------------
 * Reported as "sign-in fails on email casing". It is not casing.
 * ---------------------------------------------------------------------------
 *
 * GoTrue is already case-insensitive, so the capital letter was never the problem. **Whitespace
 * was.** `/api/signup` normalised with `trim().toLowerCase()` and the sign-in form sent the
 * input box's value untouched, so an address that arrived with a leading space — from an
 * autofill, a paste, a keyboard that offers one after an @ — was stored one way and looked up
 * another. The answer is "invalid credentials", which is the least informative thing it could
 * possibly say and sends people to check their password.
 *
 * Two doors to one value, drifted, which is the failure this project keeps meeting. So this
 * exists to be the only door: a form that normalises and a route that normalises differently
 * are two implementations that agree until somebody edits one.
 *
 * Lower-casing as well as trimming, to match what signup already stored. That is technically
 * more than the RFC allows — a local part is case-sensitive on paper — and it is what every
 * provider people actually use does, so matching signup matters more than matching the RFC.
 */
export function normaliseEmail(input: string): string {
  return String(input ?? "").trim().toLowerCase();
}
