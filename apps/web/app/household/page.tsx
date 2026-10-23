import Link from "next/link";
import { redirect } from "next/navigation";
import { UnitsSetting } from "./units";
import { TimezoneSetting } from "./timezone";
import { AllergenSetting } from "./allergens";
import { ChoosingSetting } from "./choosing";
import { StoreSetting } from "./store";
import { GroupSetting } from "./groups";
import { SignOutButton } from "../recipes/sign-out";
import { krogerConfig } from "@/lib/kroger";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { readMemberSettings } from "@/lib/member-settings";
import { listGroupsWithCounts } from "@/lib/shopping-groups";
import { MEMBER_COLOURS, invitationState } from "@pashki/platform-client";
import { Roster } from "./roster";
import { childTastes } from "@/lib/tastes";
import { evidence, isTelling } from "@pashki/core";

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

  /*
   * This person's own settings, which is why they are read separately from the household's.
   *
   * `family.recipeLayout` is gone: Stephen choosing the recipe book changed what Paige saw, and
   * Paige is the one who cooks from it (§87).
   */
  const mine = await readMemberSettings(supabase, family.id, auth.user.id);

  /*
   * The groups, with their counts, read here rather than in the client component — a screen that
   * fetches its own list renders empty first and then fills, and "nothing in it yet" is a sentence
   * this one says on purpose.
   */
  const groups = await listGroupsWithCounts(supabase, family.id);

  // read here, not in the client component: `lib/kroger` holds a client secret and
  // `check-server-only` would refuse it in a "use client" file
  const krogerEnvironment = krogerConfig()?.environment ?? null;

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
        <TimezoneSetting current={family.timezone} />
      </section>

      {/*
        * Beside units and timezone because it is the same kind of thing: a household setting that
        * governs a shared document. "This household avoids peanuts" identifies nobody, which is
        * why it is here and not on a person (§71) — and you do not cook two dinners, so it was
        * always household-wide in effect.
        */}
      <section style={{ marginBottom: "2rem" }}>
        <h2>What you avoid</h2>
        <p className="subtitle">
          An allergy or anything else this kitchen keeps out. It applies to everyone here, because
          one dinner gets cooked.
        </p>
        <AllergenSetting current={family.avoidedAllergens} />
      </section>

      {/*
        * Its own section, below the household ones, because it is the only setting on this screen
        * that is **not** shared — and a personal setting sitting inside "What you avoid" read as
        * one more thing that applies to everybody. Which settings change what the whole household
        * gets, and which change only your own view, is the distinction this screen has to make
        * visible rather than leave to be discovered.
        */}
      <section style={{ marginBottom: "2rem" }}>
        <h2>How you read the recipe book</h2>
        <p className="subtitle">
          Yours alone — everybody here picks their own, and changing this changes nothing for
          anyone else.
        </p>
        <ChoosingSetting current={mine.layout} />
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Where you shop</h2>
        <p className="subtitle">
          Pick a Kroger store and the week&rsquo;s shopping list can go to a cart there — with
          shelf prices, and the aisle each thing is in at <em>that</em> store.
        </p>
        <StoreSetting current={family.krogerLocationId} environment={krogerEnvironment} />
      </section>

      {/*
        * Beside where you shop, because it is the same question asked by the household rather than
        * by Kroger: Costco, HEB, Trader Joes, Boo Basket. A *group*, not a store — "Boo Basket" is
        * a Halloween gift basket, and a `store` field would either drop that group or lie about it.
        *
        * Groups are also made from the shopping list's add box, which is where somebody actually
        * is when they discover they want one. This screen exists for the two things that box
        * cannot do: rename without splitting the group, and remove the label without losing the
        * shopping.
        */}
      <section style={{ marginBottom: "2rem" }}>
        <h2>How you group the list</h2>
        <p className="subtitle">
          Somewhere to put the things that are not from a recipe — a shop you make a separate trip
          to, or a basket you are filling. Anything you add to the week&rsquo;s list can go in one.
        </p>
        <GroupSetting groups={groups} />
      </section>

      {/*
        * Signing out lives here now, not in the recipes header.
        *
        * It is an account action rather than navigation, and it sat beside four links a thumb
        * reaches for in a kitchen. One tab away, at the foot of the screen that holds the other
        * account-shaped settings.
        */}
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
                    // `course` is excluded, the way `warningsFor` already excludes it: "rates
                    // main highly" sorts first because it has the most ratings behind it, and
                    // says a child likes dinner (§ TELLING_DIMENSIONS)
                    .filter((reading) => reading.state === "pattern" && isTelling(reading.dimension))
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
      <section style={{ marginTop: "2rem" }}>
        <SignOutButton />
      </section>

    </main>
  );
}
