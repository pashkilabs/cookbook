import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { memberIdFor } from "@/lib/member-settings";
import { hashInvitationToken, invitationState } from "@pashki/platform-client";
import { AcceptInvitation } from "./accept";

/**
 * Where an invitation link lands.
 *
 * Two people arrive here and both must work: somebody who already has an account, and somebody
 * who does not. **Neither is told which** — the page says the same thing about the invitation
 * either way, and the difference is only in what it offers them to do next, which they already
 * know about themselves.
 *
 * The token is in the URL because it was in an email. It is hashed before it touches the
 * database, so a query log or a slow-query trace never contains the thing that claims the
 * invitation.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();

  const invitation = await platformStore().findInvitationByTokenHash(hashInvitationToken(token));

  /*
   * ---------------------------------------------------------------------------
   * A used token, and a used token belonging to *you*, are different facts
   * ---------------------------------------------------------------------------
   *
   * Reported as "signed out every time she closes the app", and it was not a session fault at all:
   * her home-screen icon pointed at **this URL** rather than at the app. Every launch loaded a
   * spent token, was correctly told the invitation had been used, and the only way onward was
   * "Sign in" — which she already was. The loop was a bookmark.
   *
   * That is not purely a mistake she made. The invitation email contains **no address but the
   * token**: it says the link works once and never names where the app lives, so the only URL she
   * ever received was this one. Adding it to the home screen is the obvious thing to do, not a
   * careless one.
   *
   * So a signed-in visitor who is already a member of the household this token was for is sent
   * **into the app**. There is nothing to tell them — the token is spent because they spent it —
   * and the redirect makes the bookmark work rather than explaining why it does not.
   *
   * Asked about *this* household rather than `findFamilyForAccount`, which returns an account's
   * owned household first and its earliest membership otherwise: somebody in two households would
   * get the wrong answer from it, and "are you in the one this token was for" is the actual
   * question.
   */
  const alreadyIn =
    auth.user && invitation ? await memberIdFor(invitation.familyId, auth.user.id) : null;
  if (alreadyIn) redirect("/recipes");

  if (!invitation) {
    return (
      <main className="welcome">
        <p className="wordmark">Pashki</p>
        <h1>That invitation is not valid</h1>
        <p className="subtitle">
          The link may have been used already, replaced by a newer one, or withdrawn. Ask whoever
          invited you to send another.
        </p>
        <Onward signedIn={Boolean(auth.user)} />
      </main>
    );
  }

  const state = invitationState(invitation);
  if (state !== "pending") {
    const said = {
      accepted: "That invitation has already been used.",
      revoked: "That invitation was withdrawn.",
      superseded: "That invitation was replaced by a newer one.",
      expired: "That invitation has expired.",
      pending: "",
    }[state];

    return (
      <main className="welcome">
        <p className="wordmark">Pashki</p>
        <h1>{said}</h1>
        <p className="subtitle">
          Ask whoever invited you to send another — invitations last seven days and work once.
        </p>
        <Onward signedIn={Boolean(auth.user)} />
      </main>
    );
  }

  return (
    <main className="welcome">
      <p className="wordmark">Pashki</p>
      <h1>You have been invited to {invitation.familyName}</h1>
      <p className="subtitle">
        Sharing a household means sharing its recipes, its week and its shopping list — and having
        your own opinion of every dish.
      </p>

      {auth.user ? (
        <AcceptInvitation token={token} email={invitation.email} signedInAs={auth.user.email ?? ""} />
      ) : (
        <>
          <div className="notice">
            The invitation was sent to <strong>{invitation.email}</strong>. Sign in with that
            address, or create an account for it, and you will join automatically.
          </div>
          <div className="tabs">
            <Link className="button" href={`/sign-in?invited=${encodeURIComponent(invitation.email)}`}>
              Sign in or sign up
            </Link>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * The way out of a dead end, which depends on whether there is a session.
 *
 * Both failure branches above offered "Sign in" unconditionally — to a signed-in visitor that is
 * an instruction to do something they have already done, and it was the whole of the loop that got
 * reported as being signed out. A visitor reaching this page with a spent token for somebody
 * else's household is still signed in and still has an app to go to.
 */
function Onward({ signedIn }: { signedIn: boolean }) {
  return signedIn ? (
    <Link className="button" href="/recipes">
      Open Pashki
    </Link>
  ) : (
    <Link className="button" href="/sign-in">
      Sign in
    </Link>
  );
}
