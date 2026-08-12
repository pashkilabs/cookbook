import type {
  Device,
  EntitlementResult,
  Platform,
  PlatformClient,
  PlatformClientOptions,
  QuotaOutcome,
  Session,
  SignedToken,
  TokenPayload,
} from "./types.js";
import { DEFAULT_GRACE_DAYS, evaluateAccess, graceUntilFor, systemClock } from "./access.js";

/** The counter the recipe app spends. Callers may name another. */
export const DEFAULT_QUOTA = "imports";

/**
 * Build a platform client for one signed-in account.
 *
 * The caller has already authenticated; this takes the account id and answers
 * questions about it. Everything that touches storage goes through the injected
 * `PlatformStore`, and everything that touches time goes through the injected
 * clock — which is what makes the grace-window behaviour testable at the boundary
 * rather than approximately.
 */
export function createPlatformClient(options: PlatformClientOptions): PlatformClient {
  const { store, accountId, signer } = options;
  const clock = options.clock ?? systemClock;
  const graceDays = options.graceDays ?? DEFAULT_GRACE_DAYS;

  async function getSession(): Promise<Session> {
    const account = await store.findAccount(accountId);
    if (!account) throw new Error(`no account for ${accountId}`);

    const family = await store.findFamilyForAccount(accountId);
    // An account without a household is a broken signup, not a state to paper
    // over: every app table is keyed on family_id, so there is nowhere to put data.
    if (!family) throw new Error(`account ${accountId} belongs to no family`);

    return { account, family, members: await store.listMembers(family.id) };
  }

  async function getEntitlement(appKey: string): Promise<EntitlementResult | null> {
    const family = await store.findFamilyForAccount(accountId);
    if (!family) return null;

    const entitlement = await store.findEntitlement(family.id, appKey);
    if (!entitlement) return null;

    // Grace is policy, so it is computed here rather than read from the row.
    const graceUntil = graceUntilFor(entitlement.validUntil, graceDays);
    const window = { validUntil: entitlement.validUntil, graceUntil };
    const access = evaluateAccess(window, clock());

    const result: EntitlementResult = {
      entitlement: { ...entitlement, graceUntil },
      access,
    };

    if (signer) {
      const members = await store.listMembers(family.id);
      const payload: TokenPayload = {
        v: 1,
        familyId: family.id,
        accountId,
        // display names only. No emails, no ratings, nothing a leaked token would
        // turn into a privacy incident.
        members: members.map((member) => ({
          id: member.id,
          displayName: member.displayName,
          isChild: member.isChild,
        })),
        entitlements: {
          [entitlement.appKey]: { tier: entitlement.tier, quota: entitlement.quota },
        },
        issuedAt: clock().toISOString(),
        validUntil: entitlement.validUntil,
        graceUntil,
      };
      const token: SignedToken = { token: await signer.sign(payload), payload };
      result.token = token;
    }

    return result;
  }

  /**
   * Spend quota. Server-authoritative by construction: the balance a device carries
   * in its token is a snapshot for display, and this is the only thing that moves
   * it. Two devices offline at once would otherwise both believe they held the last
   * import.
   */
  async function consumeQuota(
    appKey: string,
    amount: number,
    quota: string = DEFAULT_QUOTA,
  ): Promise<QuotaOutcome> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`consumeQuota needs a positive whole amount, got ${amount}`);
    }

    const family = await store.findFamilyForAccount(accountId);
    if (!family) return { status: "no-entitlement" };

    const entitlement = await store.findEntitlement(family.id, appKey);
    if (!entitlement) return { status: "no-entitlement" };

    const spent = await store.spendQuota({ familyId: family.id, appKey, quota, amount });
    if (spent) return { status: "allowed", counter: spent };

    // Refused. Report the counter as it stands so a caller can say "500 of 500
    // used, resets on the 1st" rather than a bare failure.
    const counter = entitlement.quota[quota] ?? { limit: 0, used: 0, resetsAt: null };
    return { status: "exceeded", counter };
  }

  async function registerDevice(platform: Platform, deviceId?: string): Promise<Device> {
    return store.registerDevice({
      accountId,
      platform,
      ...(deviceId === undefined ? {} : { deviceId }),
    });
  }

  return { getSession, getEntitlement, consumeQuota, registerDevice };
}
