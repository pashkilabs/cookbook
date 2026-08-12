import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

export {
  discoverLocalStack,
  readLocalInstance,
  type LocalInstance,
  type LocalStack,
} from "../local-instance.js";

/**
 * Test support that other packages may use.
 *
 * Building a household means writing to platform tables, which
 * `scripts/check-platform-tables.mjs` forbids outside the seam and `packages/db`.
 * That rule is right — and `platform-client` deliberately exposes no creation API,
 * because platform writes are a service-role operation. So the fixture builder lives
 * here, where the schema does, rather than each package getting an exemption.
 *
 * It also removes a third copy of this setup: `db` and `platform-client` both grew
 * their own by hand, and they can adopt this when next touched.
 */

export interface TestHouseholdOptions {
  /** service role */
  admin: SupabaseClient;
  url: string;
  anonKey: string;
  /** distinguishes households within one test run */
  label: string;
  /** a live entitlement, so writes are not refused by the read-only predicate */
  entitled?: boolean;
}

export interface TestHousehold {
  accountId: string;
  familyId: string;
  memberId: string;
  email: string;
  /** signed in as the adult member */
  client: SupabaseClient;
}

export async function createTestHousehold(
  options: TestHouseholdOptions,
): Promise<TestHousehold> {
  const { admin, label } = options;
  const stamp = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `${stamp}@pashki.test`;
  const password = `pw-${stamp}`;

  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw user.error;
  const accountId = user.data.user!.id;

  // nothing creates this row on signup: account provisioning belongs to
  // platform-client, so a test has to do what it would do
  const account = await admin.from("accounts").insert({ id: accountId, email });
  if (account.error) throw account.error;

  const family = await admin
    .from("families")
    .insert({ name: `${label} household`, owner_account_id: accountId })
    .select("id")
    .single();
  if (family.error) throw family.error;

  const member = await admin
    .from("family_members")
    .insert({
      family_id: family.data.id,
      account_id: accountId,
      display_name: label,
      colour: null,
      is_child: false,
    })
    .select("id")
    .single();
  if (member.error) throw member.error;

  if (options.entitled !== false) {
    const entitlement = await admin.from("entitlements").insert({
      family_id: family.data.id,
      app_key: "recipes",
      tier: "full",
      quota_json: { imports: { limit: 50, used: 0, resetsAt: null } },
      valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
      grace_until: new Date(Date.now() + 37 * 86400000).toISOString(),
    });
    if (entitlement.error) throw entitlement.error;
  }

  const client = createClient(options.url, options.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  return {
    accountId,
    familyId: family.data.id as string,
    memberId: member.data.id as string,
    email,
    client,
  };
}

/**
 * Tear a household down.
 *
 * Deleting the family cascades its recipes, members and entitlement; the account has
 * to follow separately because `families` deliberately RESTRICTs deleting an owner.
 * Households need clearing now that published recipes are visible across them — a
 * leftover public row shows up in the next run's assertions.
 */
export async function deleteTestHousehold(
  admin: SupabaseClient,
  household: Pick<TestHousehold, "accountId" | "familyId">,
): Promise<void> {
  await admin.from("families").delete().eq("id", household.familyId);
  await admin.from("accounts").delete().eq("id", household.accountId);
  await admin.auth.admin.deleteUser(household.accountId);
}
