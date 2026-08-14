import { userClient } from "@/lib/supabase-server";
import { platformClient } from "@/lib/platform";
import { sendInvitationEmail } from "@/lib/invitation-email";

/**
 * Invite an adult, see who is pending, revoke one.
 *
 * Three verbs on one route, as with `/api/members`: each route file is a serverless function and
 * this project has had a deployment refused for exceeding the host's twelve-function limit (§37).
 *
 * **The response never reveals whether the address already has an account.** Nothing here looks —
 * the seam mints a token and records an invitation either way — so there is no branch that could
 * leak it. Address enumeration is the obvious attack on an invitation form, exactly as on signup.
 */
async function caller() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  return { accountId: auth.user.id, client: platformClient(auth.user.id) };
}

const message = (error: unknown) => (error instanceof Error ? error.message : "that did not work");

export async function GET() {
  const me = await caller();
  if (!me) return Response.json({ error: "sign in first" }, { status: 401 });

  try {
    return Response.json({ invitations: await me.client.listInvitations() });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 403 });
  }
}

export async function POST(request: Request) {
  const me = await caller();
  if (!me) return Response.json({ error: "sign in first" }, { status: 401 });

  let body: { email?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof body.email !== "string") {
    return Response.json({ error: "who are you inviting?" }, { status: 400 });
  }

  try {
    const { invitation, token } = await me.client.inviteAdult(body.email);

    // read after the invitation, so a failure to send cannot leave a household wondering whether
    // anything was recorded
    const session = await me.client.getSession();
    const inviter =
      session.members.find((member) => member.accountId === me.accountId)?.displayName ?? "Someone";

    const sent = await sendInvitationEmail({
      to: invitation.email,
      householdName: session.family.name,
      invitedBy: inviter,
      token,
    });

    if (!sent.sent) {
      /*
       * The invitation exists and the email did not go. Reported rather than swallowed: an
       * operator needs to know the deployment cannot send, and the household needs to know the
       * person will not receive anything. Three outcomes, not two.
       */
      console.error(`[pashki] invitation recorded but not sent: ${sent.reason} — ${sent.detail}`);
      return Response.json(
        {
          invitation,
          sent: false,
          error:
            sent.reason === "not-configured"
              ? "The invitation is saved, but this deployment cannot send email yet."
              : "The invitation is saved, but the email could not be sent.",
        },
        { status: 202 },
      );
    }

    return Response.json({ invitation, sent: true });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const me = await caller();
  if (!me) return Response.json({ error: "sign in first" }, { status: 401 });

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return Response.json({ error: "which invitation?" }, { status: 400 });
  }

  try {
    await me.client.revokeInvitation(body.id);
    return Response.json({ revoked: body.id });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 404 });
  }
}
