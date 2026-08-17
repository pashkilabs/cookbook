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
import { anthropicModelMismatch } from "@pashki/import";

/** the prefix, never the key: enough to see which dialect the id has to belong to */
const visionKeyKind = (key: string | undefined): "anthropic" | "other" | null =>
  !key ? null : key.startsWith("sk-ant-") ? "anthropic" : "other";

/**
 * "ok", "unconfigured", or the reason — imported from the same guard that refuses at
 * construction, so health cannot drift into disagreeing with the builder about what is wired.
 */
function visionWiring(): string {
  const key = process.env.PASHKI_LLM_VISION_API_KEY;
  const model = process.env.PASHKI_LLM_VISION_MODEL;
  if (!key || !model) return "unconfigured";
  return anthropicModelMismatch(key, model) ?? "ok";
}

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

        /*
         * The model ids, as values — the one deliberate exception to booleans-only above.
         *
         * A model id is not a secret; it is published pricing. And "is vision configured: true"
         * is the wrong thing to report, for the same reason `tokenSigner: true` over an
         * unparseable PEM was: presence is not correctness. `.env.local` carried
         * `google/gemma-4-31B-it` beside an `sk-ant-` key for an unknown number of days, and
         * every presence check said yes while every photograph 404'd.
         *
         * `visionWiring` is the comparison a boolean cannot make: it names the fault instead of
         * asserting health, so "what is Vercel actually running" is one curl rather than an
         * interactive CLI login. Key *kind* is derived from the prefix — never the key.
         */
        textModel: process.env.PASHKI_LLM_MODEL ?? null,
        visionModel: process.env.PASHKI_LLM_VISION_MODEL ?? null,
        visionKeyKind: visionKeyKind(process.env.PASHKI_LLM_VISION_API_KEY),
        visionWiring: visionWiring(),
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
