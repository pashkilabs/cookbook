import type {
  Device,
  EntitlementResult,
  FamilyMember,
  Platform,
  PlatformClient,
  PlatformClientOptions,
  QuotaOutcome,
  PlatformStore,
  Session,
  SignedToken,
  TokenPayload,
} from "./types.js";
import { DEFAULT_GRACE_DAYS, evaluateAccess, graceUntilFor, systemClock } from "./access.js";
import { isMemberColour, nextFreeColour } from "./member-colours.js";

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

    // The grace window comes from the row, because the RLS predicate that actually
    // enforces read-only reads the same column. Computing it here would give the
    // client and the database two opinions about when writing stops.
    const window = {
      validUntil: entitlement.validUntil,
      graceUntil: entitlement.graceUntil,
    };
    const access = evaluateAccess(window, clock());

    const result: EntitlementResult = { entitlement, access };

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
        graceUntil: entitlement.graceUntil,
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

  /** The household this account belongs to, or a refusal that says why. */
  async function ownFamily() {
    const family = await store.findFamilyForAccount(accountId);
    if (!family) throw new Error(`account ${accountId} belongs to no family`);
    return family;
  }

  async function listMembers(): Promise<FamilyMember[]> {
    return store.listMembers((await ownFamily()).id);
  }

  /**
   * Add a child: a row, and nothing else.
   *
   * `isChild: true` and `accountId: null` are set here rather than accepted from a caller,
   * because the invariant behind the whole split is that a child never has a login. The schema's
   * `child_has_no_login` check says the same thing; this makes it impossible to *ask* for rather
   * than merely refused.
   *
   * The colour defaults to whichever nobody is using, so adding a child is one field.
   */
  async function addChild(input: {
    displayName: string;
    colour?: string | null;
  }): Promise<FamilyMember> {
    const family = await ownFamily();
    const displayName = (input.displayName ?? "").trim();
    if (!displayName) throw new Error("a member needs a name");
    if (displayName.length > 60) throw new Error("that name is too long");

    const members = await store.listMembers(family.id);
    if (members.length >= 20) throw new Error("that is more people than a household");

    const colour =
      input.colour === undefined || input.colour === null
        ? nextFreeColour(members.map((member) => member.colour))
        : input.colour;
    if (!isMemberColour(colour)) throw new Error(`${colour} is not a colour a member may have`);

    return store.addMember({
      familyId: family.id,
      displayName,
      colour,
      isChild: true,
      accountId: null,
    });
  }

  async function updateMember(
    memberId: string,
    changes: { displayName?: string; colour?: string | null },
  ): Promise<FamilyMember> {
    const family = await ownFamily();

    const displayName = changes.displayName === undefined ? undefined : changes.displayName.trim();
    if (displayName !== undefined && !displayName) throw new Error("a member needs a name");
    if (displayName !== undefined && displayName.length > 60) {
      throw new Error("that name is too long");
    }
    if (changes.colour !== undefined && changes.colour !== null && !isMemberColour(changes.colour)) {
      throw new Error(`${changes.colour} is not a colour a member may have`);
    }

    const updated = await store.updateMember({
      familyId: family.id,
      memberId,
      ...(displayName === undefined ? {} : { displayName }),
      ...(changes.colour === undefined ? {} : { colour: changes.colour }),
    });
    if (!updated) throw new Error("no such member in this household");
    return updated;
  }

  /**
   * Remove a member.
   *
   * **You cannot remove yourself.** Leaving a household is a different action with different
   * consequences — who owns it afterwards, what becomes of the recipes — and allowing it here
   * would let somebody delete the only adult and strand a household behind an account that is no
   * longer a member of anything.
   *
   * The soft delete is the whole removal: `private.propagate_soft_delete` tombstones the member's
   * ratings and nulls `recipes.created_by` (§30), so nothing here needs to know about either.
   */
  async function removeMember(memberId: string): Promise<void> {
    const family = await ownFamily();
    const members = await store.listMembers(family.id);
    const target = members.find((member) => member.id === memberId);
    if (!target) throw new Error("no such member in this household");
    if (target.accountId === accountId) throw new Error("you cannot remove yourself");

    const removed = await store.removeMember({ familyId: family.id, memberId });
    if (!removed) throw new Error("no such member in this household");
  }

  async function registerDevice(platform: Platform, deviceId?: string): Promise<Device> {
    return store.registerDevice({
      accountId,
      platform,
      ...(deviceId === undefined ? {} : { deviceId }),
    });
  }

  return {
    getSession,
    getEntitlement,
    consumeQuota,
    registerDevice,
    listMembers,
    addChild,
    updateMember,
    removeMember,
  };
}

/**
 * Quota for a household, with nobody signed in.
 *
 * A background worker draining import jobs is family-scoped: it acts for a household
 * rather than as one of its adults, so `PlatformClient` — which resolves everything
 * from an `accountId` — is the wrong shape. This is the narrow widening of the seam
 * that background work needs, and it is still the only route to the entitlement.
 *
 * The alternative was letting the worker count locally, which would put a second
 * opinion about the balance beside the one the database enforces.
 */
export interface FamilyQuotaMeter {
  consume(familyId: string, amount: number): Promise<FamilyQuotaVerdict>;
}

export type FamilyQuotaVerdict =
  | { allowed: true }
  | { allowed: false; reason: "exceeded" | "no-entitlement"; detail?: string };

/**
 * A family-scoped meter, for a caller with nobody signed in.
 *
 * **Not the way an import is charged.** Spending here and recording the outcome elsewhere is two
 * statements, and the window between them is a household billed for a job that still looks
 * unfinished. `import_finish_job` does both in one transaction (decisions §32), so anything
 * draining the import queue should go through the queue, not through this.
 *
 * This remains the right shape for a spend that *is* the whole operation — where there is no
 * second write to be atomic with.
 */
export function createQuotaMeter(options: {
  store: PlatformStore;
  appKey: string;
  /** counter name; defaults to the one the recipe app spends */
  quota?: string;
}): FamilyQuotaMeter {
  const quota = options.quota ?? DEFAULT_QUOTA;

  return {
    async consume(familyId: string, amount: number): Promise<FamilyQuotaVerdict> {
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error(`consume needs a positive whole amount, got ${amount}`);
      }

      const entitlement = await options.store.findEntitlement(familyId, options.appKey);
      if (!entitlement) return { allowed: false, reason: "no-entitlement" };

      const spent = await options.store.spendQuota({
        familyId,
        appKey: options.appKey,
        quota,
        amount,
      });
      if (spent) return { allowed: true };

      const counter = entitlement.quota[quota];
      return {
        allowed: false,
        reason: "exceeded",
        ...(counter ? { detail: `${counter.used} of ${counter.limit} used` } : {}),
      };
    },
  };
}
