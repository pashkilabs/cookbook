/**
 * Which build is actually serving, and is it configured?
 *
 * Written after a day of inferring deployment state from the *shape* of failures — is that a 500
 * from the old build or the new one? — which is guesswork dressed as diagnosis. A deployment
 * should be able to say what it is.
 *
 * **Booleans only for configuration.** Whether a key is present is operational fact; its value is
 * a secret, and an unauthenticated endpoint is exactly where the temptation to leak one lives. The
 * point is to distinguish "not configured" from "configured wrongly", and presence does that
 * without printing anything.
 *
 * Deliberately unauthenticated: it is what a smoke test calls before it has a session, and what
 * tells it whether it is testing the commit it thinks it is.
 */
export async function GET() {
  const present = (name: string) => Boolean(process.env[name]);

  /*
   * A fingerprint, not the secret.
   *
   * "Present" was not enough: the scheduler's shared secret was set on both sides and *differed*,
   * so every tick got a 401 and the queue never drained, while every presence check said yes.
   * Twelve hex characters of SHA-256 over a 256-bit random secret identifies it without being
   * usable — the same reason key fingerprints are published rather than hidden — and turns "do
   * these two match" from a guess into a comparison.
   */
  const fingerprint = async (value: string | undefined) => {
    if (!value) return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest))
      .slice(0, 6)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  return Response.json(
    {
      ok: true,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      env: process.env.VERCEL_ENV ?? "local",
      configured: {
        supabase: present("NEXT_PUBLIC_SUPABASE_URL") && present("SUPABASE_SERVICE_ROLE_KEY"),
        siteUrl: present("NEXT_PUBLIC_SITE_URL"),
        // the two that were wrong in production and invisible for days
        tokenSigner: present("PASHKI_TOKEN_KEY_ID") && present("PASHKI_TOKEN_PRIVATE_KEY"),
        drainSecret: present("PASHKI_DRAIN_SECRET"),
        drainSecretFingerprint: await fingerprint(process.env.PASHKI_DRAIN_SECRET),
        drainSecretLength: process.env.PASHKI_DRAIN_SECRET?.length ?? 0,
        devEntitlement: process.env.PASHKI_DEV_ISSUE_ENTITLEMENT === "true",
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
