import { DEFAULT_COOKIE_OPTIONS, createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresh the session on navigation, and write the refreshed cookies somewhere that can
 * accept them.
 *
 * A Supabase access token is short-lived; the refresh token in the cookie is what keeps a
 * session alive. Only middleware and route handlers may set cookies — a Server Component
 * cannot, which is why `lib/supabase-server.ts` swallows the attempt. So without this file
 * nothing ever writes a refreshed token, and a person is signed out mid-session at whatever
 * point the access token expires. One screen tolerates that. Two do not: the second
 * navigation is where it shows up.
 *
 * Two details that are easy to get wrong and hard to notice:
 *
 * **`getUser()`, not `getSession()`.** `getSession` reads the cookie and believes it;
 * `getUser` asks the auth server. Only the second refreshes an expired token, which is the
 * entire reason this runs.
 *
 * **The same response object throughout.** `createServerClient` writes cookies onto the
 * response it was given, so building a fresh `NextResponse` afterwards would discard the
 * refreshed token and the session would expire anyway — silently, and only for users whose
 * token happened to be old.
 *
 * **Node, not Edge.** The Edge runtime forbids code generation from strings, and something in
 * the Supabase client's dependency graph does it at module scope — the whole middleware
 * fails to load with `EvalError` rather than failing on a code path. The alternative was
 * hand-rolling the refresh against the auth endpoint, which also means hand-rolling the
 * cookie chunking that `@supabase/ssr` does for sessions over ~3KB. Borrowing a documented
 * runtime switch beats reimplementing a footgun.
 */
export const runtime = "nodejs";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  /* whether the client wrote cookies itself, i.e. whether a real refresh happened */
  let refreshed = false;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (written: Array<{ name: string; value: string; options: CookieOptions }>) => {
          refreshed = true;
          for (const { name, value } of written) request.cookies.set(name, value);
          // rebuilt from the mutated request so the Server Components downstream read the
          // refreshed cookie, then re-applied to the response for the browser
          response = NextResponse.next({ request });
          for (const { name, value, options } of written) response.cookies.set(name, value, options);
        },
      },
    },
  );

  await supabase.auth.getUser();

  /*
   * ---------------------------------------------------------------------------
   * Re-set the session cookie even when nothing was refreshed (§89)
   * ---------------------------------------------------------------------------
   *
   * Measured, not inferred from the package's defaults: signing in produces **zero** `Set-Cookie`
   * for the auth token. `createBrowserClient` writes it through `document.cookie`, and only a
   * genuine refresh — an access token at or past its hour — makes this middleware write one.
   *
   * Safari's ITP caps a **script-written** cookie at seven days whatever `maxAge` claims, so
   * between the client write and the next server write the stored 400 days is not true on iOS.
   * Re-emitting it here closes that window on the **first navigation after sign-in**, seconds
   * later, because a cookie delivered by `Set-Cookie` is not subject to the script cap.
   *
   * **The residual, stated rather than waved at:** a tab left open across an expiry that then
   * never navigates again for seven days. The client refreshes such a tab itself, through
   * `document.cookie`, and nothing here runs to convert it — iOS makes that shape close to
   * impossible, and it is the one case this does not cover.
   *
   * **And the assumption to re-examine first:** the seven-day cap is Safari's *documented policy*,
   * not something measured here. What was measured is which path writes, on Chromium. If somebody
   * is still signed out roughly weekly after this, doubt the cap before doubting the plumbing.
   *
   * Skipped when `refreshed` is true: the client has already written fresher values onto the
   * response, and re-setting from the request would put the stale ones back.
   */
  if (!refreshed) {
    for (const cookie of request.cookies.getAll()) {
      /*
       * The auth cookie, and its chunks — a session over ~3KB is split into `…auth-token.0`,
       * `.1` and so on, so this matches the prefix rather than the exact name.
       */
      if (!/^sb-.*-auth-token(\.\d+)?$/.test(cookie.name)) continue;
      response.cookies.set(cookie.name, cookie.value, DEFAULT_COOKIE_OPTIONS);
    }
  }

  return response;
}

export const config = {
  /**
   * Everything except static assets and the seam.
   *
   * `/api/platform` is excluded deliberately: it authenticates with a bearer token, not a
   * cookie (that is the property `check-server-only` and the router's tests protect), so
   * running a cookie refresh in front of it would be doing nothing at the cost of a round
   * trip to the auth server on every call.
   */
  matcher: ["/((?!_next/static|_next/image|api/platform|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
