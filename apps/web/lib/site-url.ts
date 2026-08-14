/**
 * Where confirmation links point.
 *
 * **Not the request origin.** A `Host` header is attacker-controlled, and letting it decide the
 * link in an email is how confirmation links get poisoned — a request with a forged Host makes
 * us mail somebody a link to somewhere else. It also broke in the ordinary case: Next reports
 * `http://localhost:3000` for a request made to `127.0.0.1:3000`, which GoTrue then rejected
 * against its allow list and silently replaced with `site_url`.
 *
 * So it is configuration. It must also appear in the project's redirect allow list — GoTrue
 * matches `redirect_to` against that list and against `site_url`, and a path under `site_url`
 * is not implied.
 *
 * ---------------------------------------------------------------------------
 * Why preview deployments deliberately fail here
 * ---------------------------------------------------------------------------
 *
 * `NEXT_PUBLIC_SITE_URL` is scoped to **Production only** on the host, so a preview build does
 * not have one and this throws. That is the intended behaviour, and it was chosen over the two
 * alternatives:
 *
 * **Sharing production's value** — the state this was in — means a signup on a preview mails a
 * link to production. The confirmation succeeds, against a different deployment than the one
 * being tested, and nothing anywhere reports that it happened.
 *
 * **Deriving it from `VERCEL_URL`** looks like the fix and is worse. Preview URLs are unique per
 * deployment, so GoTrue's allow list would need a wildcard like `https://cookbook-web-*.vercel.app/**`
 * — and that list is the only thing stopping an auth redirect from handing a session to a host we
 * do not control. Anyone can deploy to `vercel.app`. Without the wildcard, GoTrue does not refuse
 * the unlisted redirect: it silently substitutes `site_url`, so the link goes to production
 * anyway, now hidden behind code that appears to have solved it.
 *
 * The cost is narrow and known. `siteUrl()` is server-side and reached from exactly two routes —
 * signup and resend — so a preview deploy serves every page and breaks only those two. Previews
 * are for looking at the app, not for testing auth; auth is tested locally against Mailpit, or
 * against production. See `docs/deployment.md`.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  // The same missing variable, but a preview knows *why* it is missing, and a message that
  // explains the decision is worth more than one that reports the symptom.
  if (process.env.VERCEL_ENV === "preview") {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is Production-only, so sign-up and resend do not work on a preview " +
        "deployment. This is deliberate: a preview cannot mail a confirmation link without either " +
        "pointing it at production or widening GoTrue's redirect allow list to cover vercel.app. " +
        "Test auth locally against Mailpit. See docs/deployment.md.",
    );
  }

  throw new Error(
    "NEXT_PUBLIC_SITE_URL is required so confirmation links do not depend on a request header",
  );
}
