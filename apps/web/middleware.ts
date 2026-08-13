import { createServerClient, type CookieOptions } from "@supabase/ssr";
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

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (written: Array<{ name: string; value: string; options: CookieOptions }>) => {
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
