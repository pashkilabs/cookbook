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
  /** joined an existing household by invitation rather than being given a new one */
  | { status: "joined"; familyId: string; familyName: string; canWrite: boolean }
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

  /*
   * The branch. Somebody who signed up *because* they were invited must join that household, not
   * be handed an empty one of their own — and this is the only moment where that is decidable
   * without a token, because the invitation link and the confirmation link are different emails
   * and only one of them can be clicked last.
   *
   * **The address is the binding, and it has just been proved.** GoTrue confirmed it three lines
   * above; the invitation was sent to it. That is a stronger claim than a token in a URL, which
   * can be forwarded.
   *
   * Ordering matters: joining first makes `provisionHousehold` a no-op, because it resolves the
   * household through membership and finds one. Provisioning stays untouched and stays
   * idempotent — the property a double-clicked signup depends on — and this reads as a branch in
   * front of it rather than a change to it.
   */
  const pending = await platformStore().findPendingInvitationForAddress(email);
  if (pending) {
    const accepted = await platformStore().acceptInvitationById({
      invitationId: pending.id,
      accountId: data.user.id,
      email,
      displayName,
    });
    if (accepted.status === "joined") {
      // no entitlement is issued: the household's own covers its members (decisions §9)
      const entitlement = await platformStore().findEntitlement(accepted.familyId, "recipes");
      return {
        status: "joined",
        familyId: accepted.familyId,
        familyName: accepted.familyName,
        canWrite: entitlement !== null,
      };
    }
    // a race — revoked or superseded between the lookup and the claim. Fall through and
    // provision normally rather than stranding somebody with no household at all.
  }

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
