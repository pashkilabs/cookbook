import { evaluateAccess } from "@pashki/platform-client";
import { platformStore } from "./platform";

/**
 * The entitlement a household is founded with.
 *
 * ---------------------------------------------------------------------------
 * Why every new household gets one, and why that is a decision rather than a default
 * ---------------------------------------------------------------------------
 *
 * This was `issueDevelopmentEntitlement`, off unless `PASHKI_DEV_ISSUE_ENTITLEMENT` was set, so
 * **every household created through public signup was read-only from its first second.** The
 * reasoning behind that was sound and it was about *issuance*: production entitlements come from
 * billing, there is no billing, so nothing should issue one.
 *
 * What it missed is that the meter was gating nothing. There is no subscription to sell, so a
 * household refused a write is not being asked to pay — it is being stopped by **a wall with no
 * door**. Stephen's sister met it on her first screen (§99): she chose how she wanted to read the
 * recipe book and the write was refused, correctly, by a predicate protecting revenue that does
 * not exist yet.
 *
 * So the entitlement is **unbounded until billing exists, and revisited when it does** (§100).
 * That sentence is the decision; everything below is its implementation. `issue:entitlement`
 * stays as the manual path, for re-issuing and for whatever billing eventually needs.
 *
 * ---------------------------------------------------------------------------
 * "Unbounded" has to be written as a date, because the column will not take anything else
 * ---------------------------------------------------------------------------
 *
 * `valid_until` and `grace_until` are both NOT NULL with no default, and the migration says why:
 * *"issuance must state the window rather than inherit one silently."* That rule is right and it
 * means there is no way to express "no window" except a date far enough away to be obviously not
 * a real one. Hence a stated sentinel with a name, rather than a quietly enormous number — a
 * reader who finds `2099` in a row should be able to tell it from an expiry somebody chose.
 *
 * It is deliberately **not** `9999-12-31`: `Date.parse` handles it, Postgres handles it, and a
 * value at the edge of what a timestamp can hold invites a different class of bug than a date
 * that is merely far away.
 */
const UNBOUNDED_UNTIL = "2099-12-31T23:59:59.000Z";

/**
 * The one meter that stays, because it is not about billing.
 *
 * An import costs an inference call, signup is public, and a renewing cap is the difference
 * between a cost and an unbounded cost. So the *window* is unbounded and the *import rate* is
 * not, which are different questions that the single word "entitlement" runs together.
 *
 * **50 a month, measured rather than picked.** Across every household on the hosted project the
 * busiest real month is **40 imports** — one household in August, importing a collection — and
 * every other household-month is in single figures. 25, the old development value, would have
 * refused that household mid-import. 50 clears the only observed burst with room and is the
 * number `smoke.mjs` has always granted itself.
 *
 * It is a cost guard, not a tier. The tier design sets the real one.
 */
const IMPORTS_PER_MONTH = 50;
const PERIOD_DAYS = 30;

/**
 * `resetsAt` is a real date, and that is a fix rather than a detail.
 *
 * `platform_spend_quota` rolls a counter over inside the spending statement, and its condition is
 * `if resets is not null and now() > resets`. Every entitlement ever issued here — **98 of 98 on
 * the hosted project**, from the development path, from smoke, and from `issue:entitlement` —
 * carries `resetsAt: null` beside `periodDays: 30`. A period with no anchor never elapses, so
 * none of them has ever rolled over: they are one-off allowances wearing a monthly label.
 *
 * Nothing has noticed because nothing has run out. The highest `used` anywhere is 92 against a
 * limit of 500, and the households capped at 50 are in single figures — so this is a wall that
 * exists and has not been walked into, which is the same shape as a permission nothing has
 * exercised. A household that actually imported 50 recipes would have been refused the 51st
 * forever.
 */
function firstPeriodEnd(now: Date): string {
  return new Date(now.getTime() + PERIOD_DAYS * 86400000).toISOString();
}

/**
 * Issue the founding entitlement for a newly created household.
 *
 * Returns what happened rather than throwing, which is unchanged from the development version and
 * for the same reason: a household with no entitlement is a legitimate state — it can read and
 * not write — so failing to issue must not fail a sign-up. A failure is reported rather than
 * silent.
 *
 * The field is `entitled` — *can this household write now* — and not `issued`, because those are
 * different questions and the difference is a real case. An operator can issue a bounded window
 * with `issue:entitlement --days 30`, and when it lapses this finds a row, correctly declines to
 * overwrite somebody's deliberate decision, and must **not** then report that the household can
 * write. Naming the field after the action rather than the outcome is what made that wrong.
 */
export async function issueFoundingEntitlement(
  familyId: string,
  now: Date = new Date(),
): Promise<{ entitled: boolean; reason?: string }> {
  try {
    /*
     * Read first, and this is the load-bearing line rather than an optimisation.
     *
     * `provisionForConfirmedAccount` runs on **every confirmed sign-in** — that is what makes it
     * idempotent and what lets the confirmation route and the sign-in route both call it without
     * coordinating. And `issueEntitlement` is an **upsert that replaces `quota_json` wholesale**,
     * by design, so a replayed billing webhook updates the window rather than duplicating it.
     *
     * Those two facts are individually right and compose into a quota that can never bind:
     * issuing unconditionally here would reset `used` to 0 on every sign-in, so a household
     * could spend its monthly imports and get them all back by signing out and in. The meter
     * would read as present and enforce nothing — a guard whose existence is not its assertion.
     *
     * So this **ensures** rather than issues. The useful side effect is that an existing
     * household that has no entitlement — there are twelve on the hosted project, Stephen's
     * sister's among them — is healed on its owner's next sign-in, rather than by a hand-written
     * UPDATE against production.
     */
    const existing = await platformStore().findEntitlement(familyId, "recipes");
    if (existing) {
      // a bounded window an operator chose is theirs to end; this reports it rather than renewing it
      return evaluateAccess(existing, now).canWrite
        ? { entitled: true, reason: "already entitled" }
        : { entitled: false, reason: "an existing entitlement has lapsed — re-issue it deliberately" };
    }

    await platformStore().issueEntitlement({
      familyId,
      appKey: "recipes",
      tier: "full",
      quota: {
        imports: {
          limit: IMPORTS_PER_MONTH,
          used: 0,
          resetsAt: firstPeriodEnd(now),
          periodDays: PERIOD_DAYS,
        },
      },
      validUntil: UNBOUNDED_UNTIL,
      graceUntil: UNBOUNDED_UNTIL,
    });
    return { entitled: true };
  } catch (thrown) {
    return { entitled: false, reason: thrown instanceof Error ? thrown.message : "issuance failed" };
  }
}

/** Exported for the tests and for anything that needs to recognise a founding row. */
export const FOUNDING = {
  unboundedUntil: UNBOUNDED_UNTIL,
  importsPerMonth: IMPORTS_PER_MONTH,
  periodDays: PERIOD_DAYS,
} as const;
