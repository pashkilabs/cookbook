import type {
  Account,
  Device,
  Family,
  FamilyMember,
  Platform,
  PlatformStore,
  Quota,
  QuotaCounter,
  RegisterDeviceInput,
  SpendQuotaInput,
  StoredEntitlement,
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
  entitlements?: StoredEntitlement[];
}

export interface InMemoryStore extends PlatformStore {
  /** what the store holds now, for assertions the client interface does not expose */
  peekEntitlement(familyId: string, appKey: string): StoredEntitlement | undefined;
  devices: Device[];
}

export function createInMemoryStore(seed: Seed = {}): InMemoryStore {
  const accounts = [...(seed.accounts ?? [])];
  const families = [...(seed.families ?? [])];
  const members = [...(seed.members ?? [])];
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

    async findEntitlement(familyId, appKey) {
      const found = entitlements.find((e) => e.familyId === familyId && e.appKey === appKey);
      return found ? { ...found, quota: structuredClone(found.quota) } : null;
    },

    // mirrors the database function: refuse rather than exceed, and refuse an
    // unknown counter rather than treating it as unlimited
    async spendQuota(input: SpendQuotaInput): Promise<QuotaCounter | null> {
      const entitlement = entitlements.find(
        (e) => e.familyId === input.familyId && e.appKey === input.appKey,
      );
      if (!entitlement) return null;
      const counter = entitlement.quota[input.quota];
      if (!counter) return null;
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
  };
}

export const ACCOUNT_ID = "acc-1";
export const FAMILY_ID = "fam-1";

export function standardSeed(
  quota: Quota = { imports: { limit: 10, used: 0, resetsAt: null } },
): Seed {
  return {
    accounts: [{ id: ACCOUNT_ID, email: "adult@example.test" }],
    families: [{ id: FAMILY_ID, name: "Household", ownerAccountId: ACCOUNT_ID }],
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
      },
    ],
  };
}

export const platforms: Platform[] = ["ios", "android", "web"];
