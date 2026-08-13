import { createClient } from "@supabase/supabase-js";

/**
 * An anon-key client for auth calls that must not carry a session.
 *
 * Sign-up and resend go through this rather than through the cookie-bound `userClient`,
 * because neither should attach to or disturb whoever is currently signed in on this browser.
 * No service role: creating an account is something the anon key is allowed to do, and reaching
 * for the admin API here is what produced the bug this replaces.
 */
export function anonAuth() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
