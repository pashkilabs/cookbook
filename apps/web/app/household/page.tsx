import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { MEMBER_COLOURS, invitationState } from "@pashki/platform-client";
import { Roster } from "./roster";

/**
 * Who is in the household.
 *
 * The screen that makes per-member ratings mean anything: until a household can name its people,
 * the five-point scale and the "whole family likes" filter have exactly one opinion to work with.
 *
 * Members come from the seam rather than a query — `family_members` is a platform table and
 * `check-platform-tables.mjs` fails the build on a direct read.
 */
export default async function HouseholdPage() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) {
    return (
      <main>
        <h1>Household</h1>
        <div className="notice">
          This account has no household yet. Signing out and back in completes provisioning.
        </div>
      </main>
    );
  }

  const [members, invitations] = await Promise.all([
    platformStore().listMembers(family.id),
    platformStore().listInvitations(family.id),
  ]);
  const me = members.find((member) => member.accountId === auth.user!.id);

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href="/recipes">← {family.name}</Link>
      </p>

      <h1>Who eats here</h1>
      <p className="subtitle">
        Everyone you add can have their own opinion of a recipe. Children get a name and a colour
        — no account, no sign-in, nothing to remember.
      </p>

      <Roster
        // the seam owns the vocabulary; a server component is where it may be read
        colours={MEMBER_COLOURS.map((colour) => ({ key: colour.key, label: colour.label }))}
        invitations={invitations
          .filter((invitation) => invitationState(invitation) === "pending")
          .map((invitation) => ({
            id: invitation.id,
            email: invitation.email,
            expiresAt: invitation.expiresAt,
          }))}
        members={members.map((member) => ({
          id: member.id,
          displayName: member.displayName,
          colour: member.colour,
          isChild: member.isChild,
          isYou: member.id === me?.id,
        }))}
      />
    </main>
  );
}
