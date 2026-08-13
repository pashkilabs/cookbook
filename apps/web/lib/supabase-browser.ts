import { createBrowserClient } from "@supabase/ssr";

/**
 * The client the browser holds. Anon key only.
 *
 * Never the seam: `@pashki/platform-client` needs the service role, and
 * `scripts/check-server-only.mjs` fails the build if a `"use client"` file imports it.
 * What the browser may do to platform data, it does through `/api/platform`.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
