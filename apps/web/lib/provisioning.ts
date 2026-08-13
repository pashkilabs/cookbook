import { createClient } from "@supabase/supabase-js";
import { platformStore } from "./platform";
import { issueDevelopmentEntitlement } from "./dev-entitlement";

/**
 * Provisioning happens at **first confirmed sign-in**, not at sign-up.
 *
 * The alternative was to leave it at sign-up and gate it, and that collapses on inspection:
 * at sign-up nothing is confirmed yet, by definition, so "gated at sign-up" means "never
 * runs at sign-up". The question is only where it moves to.
 *
 * Why it must move at all: an unconfirmed account is a claim on an address, not ownership of
 * one. Provisioning at sign-up would let anybody spend somebody else's address on an
 * `accounts` row, a `families` row they own, and a `family_members` row — none of which the
 * real owner ever asked for, and `accounts.email` would fill up with addresses nobody
 * verified. The household is the first durable thing in the system; it should not exist on an
 * unproven claim.
 *
 * What makes the move safe rather than fiddly is that `provisionHousehold` is already
 * idempotent. Every confirmed sign-in can call this; only the first does any work. So there
 * is no "have I provisioned yet?" flag to keep, and the confirmation route and the sign-in
 * route can both call it without coordinating.
 *
 * The household name and display name are carried on the auth user's `user_metadata`, set at
 * sign-up. Metadata is user-writable, which is fine for exactly this: the worst a person can
 * do is choose a different name for their own household.
 */
export type ProvisionOutcome =
  | { status: "provisioned"; familyId: string; created: boolean; canWrite: boolean }
  | { status: "unauthenticated" }
  | { status: "unconfirmed" };

export async function provisionForConfirmedAccount(accessToken: string): Promise<ProvisionOutcome> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // asked of the auth server rather than decoded here: this is the same reasoning as the
  // seam's authenticator (decisions §16 notes it), and a revoked session must stop working
  // immediately rather than at expiry
  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data.user) return { status: "unauthenticated" };

  // The gate. GoTrue will not mint a session for an unconfirmed account when confirmations
  // are on, so this should be unreachable — which is exactly why it is checked. It is the one
  // line standing between "somebody proved they own this address" and a household.
  if (!data.user.email_confirmed_at) return { status: "unconfirmed" };

  const email = data.user.email;
  if (!email) return { status: "unauthenticated" };

  const metadata = data.user.user_metadata ?? {};
  const householdName = asName(metadata.household_name) ?? `${email.split("@")[0]}'s household`;
  const displayName = asName(metadata.display_name) ?? email.split("@")[0]!;

  const provisioned = await platformStore().provisionHousehold({
    accountId: data.user.id,
    email,
    householdName,
    displayName,
  });

  const entitlement = await issueDevelopmentEntitlement(provisioned.family.id);

  return {
    status: "provisioned",
    familyId: provisioned.family.id,
    created: provisioned.created,
    canWrite: entitlement.issued,
  };
}

/** Metadata arrives as `unknown` and is user-writable, so it is checked rather than trusted. */
function asName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return null;
  return trimmed;
}
