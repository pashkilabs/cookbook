import type { SupabaseClient } from "@supabase/supabase-js";
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
  Tier,
} from "./types.js";

/**
 * The Supabase implementation of `PlatformStore` — and the only file in the repo
 * that queries `accounts`, `families`, `family_members`, `devices` or
 * `entitlements`. `scripts/check-platform-tables.mjs` enforces that.
 *
 * Requires the **service role**. Platform tables are read-only to clients by design
 * (packages/db), and the quota function is service-role only, so this runs on a
 * server and never in a browser or an app bundle.
 *
 * Swapping storage, or extracting a real platform service for app #2, means writing
 * another one of these. No caller changes.
 *
 * The client is deliberately untyped rather than `SupabaseClient<Database>`.
 * Generated types would check table and column names here, but they type embedded
 * resources (`families!inner(...)`) awkwardly enough to need casts that hide more
 * than they catch. What guards these query shapes is the integration test in
 * test/supabase-store.test.ts, which runs every one of them against a real database
 * — a wrong column name fails there loudly.
 */
export function createSupabasePlatformStore(supabase: SupabaseClient): PlatformStore {
  return {
    async findAccount(accountId: string): Promise<Account | null> {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, email")
        .eq("id", accountId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: data.id, email: data.email } : null;
    },

    /**
     * The household the account owns, or failing that its earliest membership.
     *
     * Owned-first is deliberate: an adult invited into a second household should
     * still land in their own. Multiple memberships are possible in the schema, so
     * the tie-break is stated rather than left to row order.
     */
    async findFamilyForAccount(accountId: string): Promise<Family | null> {
      const owned = await supabase
        .from("families")
        .select("id, name, owner_account_id")
        .eq("owner_account_id", accountId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (owned.error) throw owned.error;
      if (owned.data) return toFamily(owned.data);

      const member = await supabase
        .from("family_members")
        .select("family_id, families!inner(id, name, owner_account_id, deleted_at)")
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (member.error) throw member.error;

      const family = member.data?.families as
        | { id: string; name: string; owner_account_id: string; deleted_at: string | null }
        | undefined;
      if (!family || family.deleted_at !== null) return null;
      return toFamily(family);
    },

    async listMembers(familyId: string): Promise<FamilyMember[]> {
      const { data, error } = await supabase
        .from("family_members")
        .select("id, family_id, account_id, display_name, colour, is_child")
        .eq("family_id", familyId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data.map((row) => ({
        id: row.id,
        familyId: row.family_id,
        accountId: row.account_id,
        displayName: row.display_name,
        colour: row.colour,
        isChild: row.is_child,
      }));
    },

    async findEntitlement(familyId: string, appKey: string): Promise<StoredEntitlement | null> {
      const { data, error } = await supabase
        .from("entitlements")
        .select("family_id, app_key, tier, quota_json, valid_until")
        .eq("family_id", familyId)
        .eq("app_key", appKey)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      return {
        familyId: data.family_id,
        appKey: data.app_key,
        tier: data.tier as Tier,
        quota: toQuota(data.quota_json),
        validUntil: data.valid_until,
      };
    },

    async spendQuota(input: SpendQuotaInput): Promise<QuotaCounter | null> {
      // One statement, atomic in the database — see the platform_spend_quota
      // migration for why this is not done here in two.
      const { data, error } = await supabase.rpc("platform_spend_quota", {
        p_family_id: input.familyId,
        p_app_key: input.appKey,
        p_quota: input.quota,
        p_amount: input.amount,
      });
      if (error) throw error;
      return data ? toCounter(data) : null;
    },

    async registerDevice(input: RegisterDeviceInput): Promise<Device> {
      if (input.deviceId) {
        const { data, error } = await supabase
          .from("devices")
          .update({ last_seen_at: new Date().toISOString(), platform: input.platform })
          .eq("id", input.deviceId)
          .eq("account_id", input.accountId)
          .is("revoked_at", null)
          .select("id, platform")
          .maybeSingle();
        if (error) throw error;
        // fall through to a fresh registration when the id is unknown or revoked,
        // so a revoked device re-registering is a new row rather than a silent
        // resurrection of the old one
        if (data) return { id: data.id, platform: data.platform as Platform };
      }

      const { data, error } = await supabase
        .from("devices")
        .insert({
          account_id: input.accountId,
          platform: input.platform,
          last_seen_at: new Date().toISOString(),
        })
        .select("id, platform")
        .single();
      if (error) throw error;
      return { id: data.id, platform: data.platform as Platform };
    },
  };
}

function toFamily(row: { id: string; name: string; owner_account_id: string }): Family {
  return { id: row.id, name: row.name, ownerAccountId: row.owner_account_id };
}

/**
 * quota_json is `jsonb`, so it arrives as unknown. Anything that is not a
 * well-formed counter is dropped rather than coerced — a half-parsed limit is worse
 * than an absent one, because `consumeQuota` refuses on an absent counter and would
 * happily spend against a limit it misread as zero.
 */
function toQuota(value: unknown): Quota {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const quota: Quota = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const counter = asCounter(raw);
    if (counter) quota[name] = counter;
  }
  return quota;
}

function toCounter(value: unknown): QuotaCounter | null {
  return asCounter(value);
}

function asCounter(raw: unknown): QuotaCounter | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const limit = Number(candidate.limit);
  const used = Number(candidate.used);
  if (!Number.isFinite(limit) || !Number.isFinite(used)) return null;
  const resetsAt = candidate.resetsAt;
  return {
    limit,
    used,
    resetsAt: typeof resetsAt === "string" ? resetsAt : null,
  };
}
