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
/**
 * What is known about the household's entitlement, where the caller knows it.
 *
 * `"lapsed"` and `"none"` are the same refusal from Postgres and two different things to say to a
 * person — *"your subscription window has passed"* is simply untrue of somebody who never had
 * one, and that was the sentence Stephen's sister would have been shown once §99's fix landed
 * and before §100's did.
 *
 * Kept after §100 made every household entitled, on purpose. The branch is now describing a state
 * no real household is in, which is exactly when it is cheap to have correct — and the lapsed
 * path returns the moment windows are real, which the unbounded entitlement's own reversal
 * condition says will happen.
 */
export type EntitlementState = "lapsed" | "none";

export function refusal(
  error: { code?: string; message: string },
  entitlement?: EntitlementState,
): string {
  if (error.code === "42501") {
    if (entitlement === "none") {
      return "This household does not have a subscription, so it cannot be changed. Everything here is still readable.";
    }
    if (entitlement === "lapsed") {
      return "This household is read-only — its subscription window has passed. Everything here is still readable.";
    }
    /*
     * Neither known. True of both states rather than guessing one: the previous wording asserted
     * a window had passed on every path that did not know, which is thirteen of the fifteen.
     */
    return "This household is read-only — it has no active subscription. Everything here is still readable.";
  }
  if (error.code === "23505") {
    return "Somebody else changed that at the same moment. Reload and try again.";
  }
  if (error.code === "23514") {
    return "That value is outside what this field allows.";
  }
  return error.message;
}

/**
 * The status that refusal belongs in.
 *
 * Here rather than in `recipe-writes`, where it used to live, because it answers the same question
 * `refusal` does — *what does this Postgres code mean to a caller* — and a path that translated the
 * message without the status got one half right. `recipe-writes` re-exports it, so its six callers
 * are unchanged.
 */
export function statusFor(error: { code?: string }): number {
  return error.code === "42501" ? 403 : 400;
}

/**
 * A refused write, carrying its own words and its own status.
 *
 * ---------------------------------------------------------------------------
 * Why a class, when `refusal()` alone looked like enough
 * ---------------------------------------------------------------------------
 *
 * Fourteen write paths call `refusal()`. The one that did not was the recipe layout, and it threw
 * `new Error(error.message)` — so Stephen's sister, the first person to open the app on a
 * household with no entitlement, chose how she wanted to read her recipe book and was told
 * **"new row violates row-level security policy for table member_settings"**, with a 400.
 *
 * The policy was right, the grant was right, the refusal was right. What reached her was the
 * mechanism's own wording, which names Postgres and not the reason.
 *
 * A **throwing** path needs more than the helper, which is why the helper was not enough: a route
 * catching `unknown` has a message and no code, so it cannot choose a status and every refusal
 * became a 400. This carries both, so `catch` has something to read. A write that *returns* a
 * result still uses `refusal` + `statusFor` directly — `createRecipeFrom` is that shape and is
 * fine as it is.
 */
export class WriteRefused extends Error {
  readonly status: number;

  constructor(error: { code?: string; message: string }, what: string, entitlement?: EntitlementState) {
    super(`${what}: ${refusal(error, entitlement)}`);
    this.name = "WriteRefused";
    this.status = statusFor(error);
  }
}
