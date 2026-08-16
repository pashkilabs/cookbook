import type {
  Account,
  Device,
  Family,
  FamilyMember,
  Clock,
  Platform,
  PlatformStore,
  Quota,
  QuotaCounter,
  RegisterDeviceInput,
  SpendQuotaInput,
  Entitlement,
} from "../src/index.js";

/**
 * An in-memory PlatformStore.
 *
 * Its real job is to prove the seam holds: if the client can be driven by this as
 * well as by Postgres, then swapping storage — or extracting a platform service for
 * app #2 — is writing one of these rather than touching callers.
 */
export interface Seed {
  accounts?: Account[];
  families?: Family[];
  members?: FamilyMember[];
  entitlements?: Entitlement[];
}

export interface InMemoryStore extends PlatformStore {
  /** what the store holds now, for assertions the client interface does not expose */
  peekEntitlement(familyId: string, appKey: string): Entitlement | undefined;
  devices: Device[];
}

/** `clock` lets a test drive the quota period rollover without waiting for one. */
export function createInMemoryStore(seed: Seed = {}, clock: Clock = () => new Date()): InMemoryStore {
  const accounts = [...(seed.accounts ?? [])];
  const families = [...(seed.families ?? [])];
  const members = [...(seed.members ?? [])];
  const invitations: Array<{
    id: string;
    familyId: string;
    email: string;
    tokenHash: string;
    expiresAt: string;
    acceptedAt: string | null;
    revokedAt: string | null;
    supersededAt: string | null;
    createdAt: string;
  }> = [];
  const entitlements = (seed.entitlements ?? []).map((e) => ({
    ...e,
    quota: structuredClone(e.quota),
  }));
  const devices: Device[] = [];
  let nextDevice = 1;

  return {
    devices,

    peekEntitlement(familyId, appKey) {
      return entitlements.find((e) => e.familyId === familyId && e.appKey === appKey);
    },

    async findAccount(accountId) {
      return accounts.find((a) => a.id === accountId) ?? null;
    },

    async findFamilyForAccount(accountId) {
      const owned = families.find((f) => f.ownerAccountId === accountId);
      if (owned) return owned;
      const membership = members.find((m) => m.accountId === accountId);
      if (!membership) return null;
      return families.find((f) => f.id === membership.familyId) ?? null;
    },

    async listMembers(familyId) {
      return members.filter((m) => m.familyId === familyId);
    },

    /*
     * The member writes, in memory. Deliberately as literal as the Supabase adapter — including
     * scoping every write by `familyId` as well as id, because a fake that is more forgiving than
     * the real thing tests the fake.
     */
    async addMember(input) {
      const member = {
        id: `member-${members.length + 1}`,
        familyId: input.familyId,
        accountId: input.accountId ?? null,
        displayName: input.displayName,
        colour: input.colour,
        isChild: input.isChild,
      };
      members.push(member);
      return member;
    },

    async updateMember(input) {
      const found = members.find(
        (m) => m.id === input.memberId && m.familyId === input.familyId,
      );
      if (!found) return null;
      if (input.displayName !== undefined) found.displayName = input.displayName;
      if (input.colour !== undefined) found.colour = input.colour;
      return { ...found };
    },

    async setMeasurementSystem(input) {
      const family = families.find((f) => f.id === input.familyId);
      if (!family) return null;
      family.measurementSystem = input.system;
      return { ...family };
    },

    async removeMember(input) {
      const at = members.findIndex(
        (m) => m.id === input.memberId && m.familyId === input.familyId,
      );
      if (at < 0) return false;
      // the real store tombstones and listMembers filters; dropping it here is the same effect
      members.splice(at, 1);
      return true;
    },

    /* Invitations, in memory — the same rules the SQL enforces, so the fake cannot be kinder. */
    async createInvitation(input) {
      for (const live of invitations) {
        if (
          live.familyId === input.familyId &&
          live.email === input.email &&
          !live.acceptedAt && !live.revokedAt && !live.supersededAt
        ) {
          live.supersededAt = clock().toISOString();
        }
      }
      const invitation = {
        id: `invite-${invitations.length + 1}`,
        familyId: input.familyId,
        email: input.email,
        expiresAt: input.expiresAt,
        acceptedAt: null as string | null,
        revokedAt: null as string | null,
        supersededAt: null as string | null,
        createdAt: clock().toISOString(),
      };
      invitations.push({ ...invitation, tokenHash: input.tokenHash });
      return invitation;
    },

    async listInvitations(familyId) {
      return invitations
        .filter((i) => i.familyId === familyId)
        .map(({ tokenHash: _hash, ...rest }) => rest);
    },

    async findInvitationByTokenHash(tokenHash) {
      const found = invitations.find((i) => i.tokenHash === tokenHash);
      if (!found) return null;
      const family = families.find((f) => f.id === found.familyId);
      const { tokenHash: _hash, ...rest } = found;
      return { ...rest, familyName: family?.name ?? "" };
    },

    async findPendingInvitationForAddress(email) {
      const found = invitations.find(
        (i) =>
          i.email === email.trim().toLowerCase() &&
          !i.acceptedAt && !i.revokedAt && !i.supersededAt &&
          Date.parse(i.expiresAt) > clock().getTime(),
      );
      return found ? { id: found.id, familyId: found.familyId } : null;
    },

    async revokeInvitation(input) {
      const found = invitations.find(
        (i) => i.id === input.invitationId && i.familyId === input.familyId && !i.acceptedAt && !i.revokedAt,
      );
      if (!found) return false;
      found.revokedAt = clock().toISOString();
      return true;
    },

    async acceptInvitationById(input) {
      const found = invitations.find((i) => i.id === input.invitationId);
      if (!found) return { status: "unknown" as const };
      return this.acceptInvitation({ ...input, tokenHash: found.tokenHash });
    },

    async acceptInvitation(input) {
      const found = invitations.find((i) => i.tokenHash === input.tokenHash);
      if (!found) return { status: "unknown" as const };
      if (found.acceptedAt) return { status: "used" as const };
      if (found.revokedAt) return { status: "revoked" as const };
      if (found.supersededAt) return { status: "superseded" as const };
      if (Date.parse(found.expiresAt) <= clock().getTime()) return { status: "expired" as const };
      if (found.email !== input.email.toLowerCase()) return { status: "wrong-address" as const };

      found.acceptedAt = clock().toISOString();
      if (!accounts.some((a) => a.id === input.accountId)) {
        accounts.push({ id: input.accountId, email: input.email.toLowerCase() });
      }
      let member = members.find(
        (m) => m.familyId === found.familyId && m.accountId === input.accountId,
      );
      if (!member) {
        member = {
          id: `member-${members.length + 1}`,
          familyId: found.familyId,
          accountId: input.accountId,
          displayName: input.displayName,
          colour: null,
          isChild: false,
        };
        members.push(member);
      }
      const family = families.find((f) => f.id === found.familyId)!;
      return {
        status: "joined" as const,
        familyId: family.id,
        familyName: family.name,
        memberId: member.id,
      };
    },

    async findEntitlement(familyId, appKey) {
      const found = entitlements.find((e) => e.familyId === familyId && e.appKey === appKey);
      return found ? { ...found, quota: structuredClone(found.quota) } : null;
    },

    /**
     * Mirrors `platform_spend_quota`: roll the period over if it has elapsed, then
     * refuse rather than exceed. An unknown counter is a refusal, not an unlimited
     * allowance.
     *
     * Kept in step with the SQL deliberately. A fake that skipped the rollover would
     * let the client tests pass while the real thing behaved differently, which is
     * the failure mode that makes fakes worse than no test.
     */
    async spendQuota(input: SpendQuotaInput): Promise<QuotaCounter | null> {
      const entitlement = entitlements.find(
        (e) => e.familyId === input.familyId && e.appKey === input.appKey,
      );
      if (!entitlement) return null;
      const counter = entitlement.quota[input.quota];
      if (!counter) return null;

      const now = clock().getTime();
      const resets = counter.resetsAt === null ? null : Date.parse(counter.resetsAt);
      if (resets !== null && now > resets) {
        counter.used = 0;
        if (counter.periodDays !== undefined && counter.periodDays > 0) {
          const period = counter.periodDays * 86_400_000;
          // advance by whole periods so a long gap lands on the right date rather
          // than several resets behind
          const elapsed = Math.ceil((now - resets) / period);
          counter.resetsAt = new Date(resets + elapsed * period).toISOString();
        } else {
          counter.resetsAt = null;
        }
      }

      if (counter.used + input.amount > counter.limit) return null;
      counter.used += input.amount;
      return { ...counter };
    },

    async registerDevice(input: RegisterDeviceInput): Promise<Device> {
      if (input.deviceId) {
        const existing = devices.find((d) => d.id === input.deviceId);
        if (existing) {
          existing.platform = input.platform;
          return { ...existing };
        }
      }
      const device: Device = { id: `device-${nextDevice++}`, platform: input.platform };
      devices.push(device);
      return { ...device };
    },

    async provisionHousehold(input) {
      const account = accounts.find((a) => a.id === input.accountId) ?? {
        id: input.accountId,
        email: input.email,
      };
      if (!accounts.includes(account)) accounts.push(account);

      const existing =
        families.find((f) => f.ownerAccountId === input.accountId) ??
        families.find((f) => members.some((m) => m.familyId === f.id && m.accountId === input.accountId));

      const family =
        existing ??
        (() => {
          const created = {
            id: `family-${families.length + 1}`,
            name: input.householdName,
            ownerAccountId: input.accountId,
            // what the column defaults to for a household that has never chosen
            measurementSystem: "us" as const,
          };
          families.push(created);
          return created;
        })();

      const mine = members.find(
        (m) => m.familyId === family.id && m.accountId === input.accountId,
      );
      if (mine) return { account, family, member: mine, created: false };

      const member = {
        id: `member-${members.length + 1}`,
        familyId: family.id,
        accountId: input.accountId,
        displayName: input.displayName,
        colour: null,
        isChild: false,
      };
      members.push(member);
      return { account, family, member, created: existing === undefined };
    },

    async issueEntitlement(input) {
      const existing = entitlements.find(
        (e) => e.familyId === input.familyId && e.appKey === input.appKey,
      );
      const issued = {
        familyId: input.familyId,
        appKey: input.appKey,
        tier: input.tier,
        quota: structuredClone(input.quota),
        validUntil: input.validUntil,
        graceUntil: input.graceUntil,
      };
      if (existing) Object.assign(existing, issued);
      else entitlements.push(issued);
      return { ...issued };
    },
  };
}

export const ACCOUNT_ID = "acc-1";
export const FAMILY_ID = "fam-1";

export function standardSeed(
  quota: Quota = { imports: { limit: 10, used: 0, resetsAt: null } },
): Seed {
  return {
    accounts: [{ id: ACCOUNT_ID, email: "adult@example.test" }],
    families: [{ id: FAMILY_ID, name: "Household", ownerAccountId: ACCOUNT_ID, measurementSystem: "us" }],
    members: [
      {
        id: "mem-1",
        familyId: FAMILY_ID,
        accountId: ACCOUNT_ID,
        displayName: "Ada",
        colour: "#f00",
        isChild: false,
      },
      {
        id: "mem-2",
        familyId: FAMILY_ID,
        accountId: null,
        displayName: "Bo",
        colour: null,
        isChild: true,
      },
    ],
    entitlements: [
      {
        familyId: FAMILY_ID,
        appKey: "recipes",
        tier: "full",
        quota,
        validUntil: "2026-09-11T00:00:00.000Z",
        graceUntil: "2026-09-18T00:00:00.000Z",
      },
    ],
  };
}

export const platforms: Platform[] = ["ios", "android", "web"];
