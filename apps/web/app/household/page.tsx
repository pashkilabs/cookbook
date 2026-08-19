import Link from "next/link";
import { redirect } from "next/navigation";
import { UnitsSetting } from "./units";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { MEMBER_COLOURS, invitationState } from "@pashki/platform-client";
import { Roster } from "./roster";
import { childTastes } from "@/lib/tastes";
import { evidence } from "@pashki/core";

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

  /*
   * What the children have said, shown with its counts.
   *
   * The empty and thin states render rather than vanishing — "Ada has rated 2 recipes, too few
   * to say anything yet" is a different message from an absent section, and somebody wondering
   * whether the feature works can tell them apart. A silent absence is indistinguishable from a
   * passing check.
   */
  const tastes = await childTastes(supabase, auth.user.id, family.id);

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href="/recipes">← {family.name}</Link>
      </p>

      <h1>Household</h1>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Units</h2>
        <p className="subtitle">
          How quantities are shown to everyone here — on the shopping list, the planner and each
          recipe. Recipes are stored exactly as they were written, so changing this converts what
          you read and never what you saved.
        </p>
        <UnitsSetting current={family.measurementSystem} />
      </section>

      <h2>Who eats here</h2>
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
          birthYear: member.birthYear,
          isYou: member.id === me?.id,
        }))}
      />

      {tastes.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>What they have said</h2>
          <p className="subtitle">
            From ratings only — what each child has actually said about food they have eaten, with
            how many ratings it stands on.
          </p>
          {tastes.map((child) => (
            <div key={child.memberId} style={{ marginBottom: "1.25rem" }}>
              <strong>{child.displayName}</strong>{" "}
              <span className="meta">{evidence(child.totalRatings)}</span>
              {/* the thin and empty states render: an absent section and "not enough yet" are
                  different messages, and only one of them says the feature is working */}
              {child.summary.state !== "pattern" ? (
                <p className="meta">{child.summary.message}</p>
              ) : (
                <ul className="meta">
                  {child.readings
                    .filter((reading) => reading.state === "pattern")
                    .map((reading) => (
                      <li key={`${reading.dimension}-${reading.value}`}>
                        {reading.leaning === "likes"
                          ? "rates "
                          : reading.leaning === "avoids"
                            ? "rates "
                            : "is split on "}
                        {reading.value}
                        {reading.leaning === "likes"
                          ? " highly"
                          : reading.leaning === "avoids"
                            ? " low"
                            : ""}{" "}
                        — {evidence(reading.count)}, average {reading.mean}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
