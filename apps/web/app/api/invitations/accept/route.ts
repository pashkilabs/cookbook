import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { hashInvitationToken } from "@pashki/platform-client";

/**
 * Claim an invitation as an already-signed-in account.
 *
 * The token is hashed here and the database matches on the hash, so the token itself never
 * reaches a query log. Everything else — single use, expiry, revocation, supersession and the
 * address binding — is decided inside `accept_invitation` in one statement, because claiming and
 * joining cannot have a window between them.
 *
 * The account's **confirmed** address is what the claim is checked against, not anything in the
 * request body: a forwarded link must not admit whoever received it.
 */
export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });
  if (!auth.user.email_confirmed_at) {
    return Response.json({ error: "confirm your email address first" }, { status: 403 });
  }

  let body: { token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof body.token !== "string" || !body.token) {
    return Response.json({ error: "no invitation" }, { status: 400 });
  }

  const email = auth.user.email;
  if (!email) return Response.json({ error: "this account has no address" }, { status: 400 });

  const displayName =
    typeof auth.user.user_metadata?.display_name === "string" &&
    auth.user.user_metadata.display_name.trim()
      ? auth.user.user_metadata.display_name.trim().slice(0, 60)
      : email.split("@")[0]!;

  const outcome = await platformStore().acceptInvitation({
    tokenHash: hashInvitationToken(body.token),
    accountId: auth.user.id,
    email,
    displayName,
  });

  if (outcome.status === "joined") {
    return Response.json({ familyId: outcome.familyId, familyName: outcome.familyName });
  }

  // each refusal says which rule fired: the holder already has the token, so naming the reason
  // tells them nothing they could not discover and everything they need to act on
  const said: Record<string, string> = {
    unknown: "That invitation is not valid.",
    used: "That invitation has already been used.",
    revoked: "That invitation was withdrawn.",
    superseded: "That invitation was replaced by a newer one.",
    expired: "That invitation has expired.",
    "wrong-address": "That invitation was sent to a different address.",
  };
  return Response.json(
    { error: said[outcome.status] ?? "That invitation is not valid.", reason: outcome.status },
    { status: 400 },
  );
}
