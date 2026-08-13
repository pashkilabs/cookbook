import { DEFAULT_GRACE_DAYS, graceUntilFor } from "@pashki/platform-client";
import { platformStore } from "./platform";

/**
 * A development-only entitlement, so a household created locally can actually write.
 *
 * **This is not a trial and it is not a free tier.** Whether either exists is an open
 * question in `docs/decisions.md`, and production issuance is a billing webhook blocked on
 * Apple's outside-purchase rules. Nothing here is a product decision: it is a switch that
 * lets a developer use the app before the billing decision has been made.
 *
 * Off unless `PASHKI_DEV_ISSUE_ENTITLEMENT` is exactly `"true"`. Named for what it is
 * rather than something comfortable like `AUTO_ENTITLE`, so that finding it set in a
 * production environment reads as a mistake instead of a feature.
 *
 * The numbers below are **development values, not policy.** Real ones arrive with the tier
 * design and the free-tier answer, and they belong to whatever issues entitlements then.
 */
const FLAG = "PASHKI_DEV_ISSUE_ENTITLEMENT";

/** 30 days, matching what the tests have always used, plus the standard week of grace. */
const DEV_DAYS = 30;
const DEV_QUOTA = { imports: { limit: 25, used: 0, resetsAt: null, periodDays: 30 } };

export function devIssuanceEnabled(): boolean {
  return process.env[FLAG] === "true";
}

/**
 * Returns what happened, rather than throwing: a household with no entitlement is a
 * legitimate state (it can read and not write), so failing to issue must not fail a
 * sign-up. It is reported so the caller can say so out loud.
 */
export async function issueDevelopmentEntitlement(
  familyId: string,
): Promise<{ issued: boolean; reason?: string }> {
  if (!devIssuanceEnabled()) {
    return { issued: false, reason: `${FLAG} is not set` };
  }

  // Deliberately NOT gated on NODE_ENV as well. `next start` serves a production build,
  // which is a normal way to run this locally, so NODE_ENV cannot tell a developer's
  // machine from a deployment — and a second gate that breaks the only workflow the flag
  // exists for is worse than one honest gate. The flag is the gate; this is the noise that
  // makes it findable in any environment's logs.
  console.warn(
    `[pashki] ${FLAG} is set: issuing a DEVELOPMENT entitlement to family ${familyId}. ` +
      `Not a trial and not a free tier — production entitlements come from billing.`,
  );

  const validUntil = new Date(Date.now() + DEV_DAYS * 86400000).toISOString();
  await platformStore().issueEntitlement({
    familyId,
    appKey: "recipes",
    tier: "full",
    quota: DEV_QUOTA,
    validUntil,
    graceUntil: graceUntilFor(validUntil, DEFAULT_GRACE_DAYS),
  });
  return { issued: true };
}
