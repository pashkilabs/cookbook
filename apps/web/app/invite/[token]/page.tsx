import Link from "next/link";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
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

  if (!invitation) {
    return (
      <main className="welcome">
        <p className="wordmark">Pashki</p>
        <h1>That invitation is not valid</h1>
        <p className="subtitle">
          The link may have been used already, replaced by a newer one, or withdrawn. Ask whoever
          invited you to send another.
        </p>
        <Link className="button" href="/sign-in">
          Sign in
        </Link>
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
        <Link className="button" href="/sign-in">
          Sign in
        </Link>
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
