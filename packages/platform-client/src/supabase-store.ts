import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Account,
  Device,
  Family,
  AcceptInvitationOutcome,
  FamilyMember,
  Invitation,
  Platform,
  PlatformStore,
  IssueEntitlementInput,
  ProvisionedHousehold,
  ProvisionHouseholdInput,
  Quota,
  QuotaCounter,
  RegisterDeviceInput,
  SpendQuotaInput,
  Entitlement,
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
/** One shape for a member row, since four methods now return one. */
function toMember(row: {
  id: string;
  family_id: string;
  account_id: string | null;
  display_name: string;
  colour: string | null;
  is_child: boolean;
  birth_year: number | null;
}): FamilyMember {
  return {
    id: row.id,
    familyId: row.family_id,
    accountId: row.account_id,
    displayName: row.display_name,
    colour: row.colour,
    isChild: row.is_child,
    birthYear: row.birth_year ?? null,
  };
}

const INVITATION_COLUMNS =
  "id, family_id, email, expires_at, accepted_at, revoked_at, superseded_at, created_at";

/** Never carries the token hash: it is not selected, so it cannot be leaked by a caller. */
function toInvitation(row: {
  id: string;
  family_id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  superseded_at: string | null;
  created_at: string;
}): Invitation {
  return {
    id: row.id,
    familyId: row.family_id,
    email: row.email,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    supersededAt: row.superseded_at,
    createdAt: row.created_at,
  };
}

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
        .select("id, name, owner_account_id, measurement_system")
        .eq("owner_account_id", accountId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (owned.error) throw owned.error;
      if (owned.data) return toFamily(owned.data);

      const member = await supabase
        .from("family_members")
        .select("family_id, families!inner(id, name, owner_account_id, measurement_system, deleted_at)")
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (member.error) throw member.error;

      const family = member.data?.families as
        | {
            id: string;
            name: string;
            owner_account_id: string;
            measurement_system: string | null;
            deleted_at: string | null;
          }
        | undefined;
      if (!family || family.deleted_at !== null) return null;
      return toFamily(family);
    },

    async listMembers(familyId: string): Promise<FamilyMember[]> {
      const { data, error } = await supabase
        .from("family_members")
        .select("id, family_id, account_id, display_name, colour, is_child, birth_year")
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
        birthYear: row.birth_year ?? null,
      }));
    },

    async addMember(input): Promise<FamilyMember> {
      const { data, error } = await supabase
        .from("family_members")
        .insert({
          family_id: input.familyId,
          account_id: input.accountId ?? null,
          display_name: input.displayName,
          colour: input.colour,
          is_child: input.isChild,
          birth_year: input.birthYear ?? null,
        })
        .select("id, family_id, account_id, display_name, colour, is_child, birth_year")
        .single();
      if (error) throw error;
      return toMember(data);
    },

    async setMeasurementSystem(input): Promise<Family | null> {
      const { data, error } = await supabase
        .from("families")
        .update({ measurement_system: input.system })
        // scoped by household id: the service role bypasses RLS, so this is the only thing
        // standing between a mistyped id and another household's row
        .eq("id", input.familyId)
        .is("deleted_at", null)
        .select("id, name, owner_account_id, measurement_system")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        ownerAccountId: data.owner_account_id,
        measurementSystem: (data.measurement_system === "metric" ? "metric" : "us"),
      };
    },

    async updateMember(input): Promise<FamilyMember | null> {
      const changes: Record<string, unknown> = {};
      if (input.displayName !== undefined) changes.display_name = input.displayName;
      if (input.colour !== undefined) changes.colour = input.colour;
      // nothing to change is not an error, and must not blank the row
      if (Object.keys(changes).length === 0) {
        const members = await this.listMembers(input.familyId);
        return members.find((member) => member.id === input.memberId) ?? null;
      }

      const { data, error } = await supabase
        .from("family_members")
        .update(changes)
        // scoped by household as well as id: the service role bypasses RLS, so this is the only
        // thing standing between a mistyped id and another household's row
        .eq("id", input.memberId)
        .eq("family_id", input.familyId)
        .is("deleted_at", null)
        .select("id, family_id, account_id, display_name, colour, is_child, birth_year")
        .maybeSingle();
      if (error) throw error;
      return data ? toMember(data) : null;
    },

    async removeMember(input): Promise<boolean> {
      /*
       * A soft delete, and the trigger does the rest: `private.propagate_soft_delete` tombstones
       * the member's ratings and nulls `recipes.created_by` (091900). A score attributed to
       * nobody is worse than no score; a recipe nobody wrote is still dinner.
       */
      const { data, error } = await supabase
        .from("family_members")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", input.memberId)
        .eq("family_id", input.familyId)
        .is("deleted_at", null)
        .select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async createInvitation(input): Promise<Invitation> {
      /*
       * Supersede first, then insert. The partial unique index allows exactly one live invitation
       * per address per household, so without this a second invitation would be refused by the
       * database rather than replacing the first — and "you already invited them" is not what a
       * person who has lost the email wants to hear.
       */
      const superseded = await supabase
        .from("invitations")
        .update({ superseded_at: new Date().toISOString() })
        .eq("family_id", input.familyId)
        .eq("email", input.email)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .is("superseded_at", null)
        .is("deleted_at", null);
      if (superseded.error) throw superseded.error;

      const { data, error } = await supabase
        .from("invitations")
        .insert({
          family_id: input.familyId,
          email: input.email,
          token_hash: input.tokenHash,
          expires_at: input.expiresAt,
          invited_by_account_id: input.invitedByAccountId,
        })
        .select(INVITATION_COLUMNS)
        .single();
      if (error) throw error;
      return toInvitation(data);
    },

    async listInvitations(familyId: string): Promise<Invitation[]> {
      const { data, error } = await supabase
        .from("invitations")
        .select(INVITATION_COLUMNS)
        .eq("family_id", familyId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data.map(toInvitation);
    },

    async findInvitationByTokenHash(tokenHash: string) {
      const { data, error } = await supabase
        .from("invitations")
        .select(`${INVITATION_COLUMNS}, families!inner(name)`)
        .eq("token_hash", tokenHash)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const family = data.families as unknown as { name: string };
      return { ...toInvitation(data as never), familyName: family.name };
    },

    async findPendingInvitationForAddress(email: string) {
      const { data, error } = await supabase
        .from("invitations")
        .select("id, family_id, expires_at")
        .eq("email", email.trim().toLowerCase())
        .is("accepted_at", null)
        .is("revoked_at", null)
        .is("superseded_at", null)
        .is("deleted_at", null)
        .gt("expires_at", new Date().toISOString())
        // the newest live one, though the unique index allows only one per household
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: data.id, familyId: data.family_id } : null;
    },

    async revokeInvitation(input): Promise<boolean> {
      const { data, error } = await supabase
        .from("invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", input.invitationId)
        // scoped by household as well as id: the service role bypasses RLS, so this is the only
        // thing between a mistyped id and another household's invitation
        .eq("family_id", input.familyId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async acceptInvitationById(input): Promise<AcceptInvitationOutcome> {
      const { data, error } = await supabase.rpc("accept_invitation_by_id", {
        p_invitation_id: input.invitationId,
        p_account_id: input.accountId,
        p_email: input.email,
        p_display_name: input.displayName,
      });
      if (error) throw error;
      return data as unknown as AcceptInvitationOutcome;
    },

    async acceptInvitation(input): Promise<AcceptInvitationOutcome> {
      const { data, error } = await supabase.rpc("accept_invitation", {
        p_token_hash: input.tokenHash,
        p_account_id: input.accountId,
        p_email: input.email,
        p_display_name: input.displayName,
      });
      if (error) throw error;
      return data as unknown as AcceptInvitationOutcome;
    },

    async findEntitlement(familyId: string, appKey: string): Promise<Entitlement | null> {
      const { data, error } = await supabase
        .from("entitlements")
        .select("family_id, app_key, tier, quota_json, valid_until, grace_until")
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
        graceUntil: data.grace_until,
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

    /**
     * Account, household, membership — in that order, because each references the last.
     *
     * Not one transaction: PostgREST has no multi-statement call, and wrapping this in a
     * database function would put household naming policy in SQL. Idempotence is what
     * covers the gap instead. A crash between the family insert and the member insert
     * leaves a household with no members, which the next attempt finds and completes
     * rather than duplicating — the check is for a family, and then for a member in it.
     */
    async provisionHousehold(input: ProvisionHouseholdInput): Promise<ProvisionedHousehold> {
      const account = await supabase
        .from("accounts")
        // the row is keyed by auth.users.id, so a repeat sign-up is the same account
        .upsert({ id: input.accountId, email: input.email }, { onConflict: "id" })
        .select("id, email")
        .single();
      if (account.error) throw account.error;

      const existing = await this.findFamilyForAccount(input.accountId);
      const family =
        existing ??
        (await (async (): Promise<Family> => {
          const created = await supabase
            .from("families")
            .insert({ name: input.householdName, owner_account_id: input.accountId })
            .select("id, name, owner_account_id, measurement_system")
            .single();
          if (created.error) throw created.error;
          return toFamily(created.data);
        })());

      const members = await this.listMembers(family.id);
      const mine = members.find((member) => member.accountId === input.accountId);
      if (mine) return { account: account.data, family, member: mine, created: false };

      const member = await supabase
        .from("family_members")
        .insert({
          family_id: family.id,
          account_id: input.accountId,
          display_name: input.displayName,
          colour: null,
          is_child: false,
        })
        .select("id, family_id, account_id, display_name, colour, is_child, birth_year")
        .single();
      if (member.error) throw member.error;

      return {
        account: account.data,
        family,
        member: {
          id: member.data.id,
          familyId: member.data.family_id,
          accountId: member.data.account_id,
          displayName: member.data.display_name,
          birthYear: member.data.birth_year ?? null,
          colour: member.data.colour,
          isChild: member.data.is_child,
        },
        created: existing === null,
      };
    },

    /**
     * Upsert on `(family_id, app_key)`, the unique the schema already carries, so a
     * replayed billing webhook updates the window rather than failing or duplicating it.
     *
     * Decides nothing about who deserves one — every value arrives from the caller.
     */
    async issueEntitlement(input: IssueEntitlementInput): Promise<Entitlement> {
      const { data, error } = await supabase
        .from("entitlements")
        .upsert(
          {
            family_id: input.familyId,
            app_key: input.appKey,
            tier: input.tier,
            quota_json: input.quota,
            valid_until: input.validUntil,
            grace_until: input.graceUntil,
          },
          { onConflict: "family_id,app_key" },
        )
        .select("family_id, app_key, tier, quota_json, valid_until, grace_until")
        .single();
      if (error) throw error;

      return {
        familyId: data.family_id,
        appKey: data.app_key,
        tier: data.tier as Tier,
        quota: toQuota(data.quota_json),
        validUntil: data.valid_until,
        graceUntil: data.grace_until,
      };
    },
  };
}

function toFamily(row: {
  id: string;
  name: string;
  owner_account_id: string;
  measurement_system?: string | null;
}): Family {
  return {
    id: row.id,
    name: row.name,
    ownerAccountId: row.owner_account_id,
    // defaulted rather than asserted: the column defaults to 'us', and a row read before that
    // migration is a household that has never expressed a preference
    measurementSystem: row.measurement_system === "metric" ? "metric" : "us",
  };
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
  const periodDays = Number(candidate.periodDays);
  return {
    limit,
    used,
    resetsAt: typeof resetsAt === "string" ? resetsAt : null,
    // absent means a one-off allowance; the rollover in platform_spend_quota reads
    // the same field, so dropping it here would make the client disagree with what
    // the database will actually do
    ...(Number.isFinite(periodDays) && periodDays > 0 ? { periodDays } : {}),
  };
}
