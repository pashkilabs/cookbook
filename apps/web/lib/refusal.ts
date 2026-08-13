/**
 * A database error, in words a person can act on.
 *
 * `42501` is the entitlement predicate refusing a write — `household_can_write` is ANDed into
 * every household table's insert, update and delete policy, so a household past its grace
 * window can read everything and change nothing. That is decisions §9 working, and showing it
 * as a five-digit code would make correct behaviour look like a bug.
 *
 * Shared so every write path says the same thing. There are three now; there will be more.
 */
export function refusal(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "This household is read-only — its subscription window has passed. Everything here is still readable.";
  }
  if (error.code === "23505") {
    return "Somebody else changed that at the same moment. Reload and try again.";
  }
  if (error.code === "23514") {
    return "That value is outside what this field allows.";
  }
  return error.message;
}
