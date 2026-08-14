import { provisionForConfirmedAccount } from "@/lib/provisioning";

/**
 * Provision the household for whoever holds this bearer token.
 *
 * Called by the sign-in form after a successful password sign-in, and mirrored by
 * `/auth/confirm`, which does the same thing at the moment of confirmation. Both are safe to
 * run repeatedly: `provisionHousehold` is idempotent, so the second and every subsequent call
 * is a read.
 *
 * It used to *create the account* — with `email_confirm: true`, which meant the app vouched
 * for addresses it had never contacted. That is gone. This route now creates nothing unless
 * the auth server confirms both that the token is live and that the address was proven.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return Response.json({ error: "a bearer token is required" }, { status: 401 });
  }

  const outcome = await provisionForConfirmedAccount(token);

  if (outcome.status === "unauthenticated") {
    return Response.json({ error: "that session is not valid" }, { status: 401 });
  }
  if (outcome.status === "unconfirmed") {
    // 403 rather than 401: the token is real, the address is not proven. Distinguishable on
    // purpose — the caller already holds a session for this address, so there is nothing left
    // to enumerate.
    return Response.json(
      { error: "confirm your email address before creating a household" },
      { status: 403 },
    );
  }

  /*
   * Two ways to end up with a household: being given a new one, or joining one you were invited
   * to. `joined` is reported distinctly so the caller can say "you're in the Smiths' kitchen"
   * rather than implying a household was created for them.
   */
  if (outcome.status === "joined") {
    return Response.json({
      familyId: outcome.familyId,
      joined: true,
      created: false,
      familyName: outcome.familyName,
      canWrite: outcome.canWrite,
    });
  }

  return Response.json({
    familyId: outcome.familyId,
    joined: false,
    created: outcome.created,
    canWrite: outcome.canWrite,
  });
}
