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
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) {
    throw new Error("NEXT_PUBLIC_SITE_URL is required so confirmation links do not depend on a request header");
  }
  return configured.replace(/\/$/, "");
}
