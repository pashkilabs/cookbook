/**
 * A Supabase client holding the service role. **Server only.**
 *
 * `cart_exports` has no client INSERT or UPDATE policy at all (§74): a row there is a claim that
 * money was spent, and the only thing entitled to make it is the route that made the request. A
 * client able to write it could erase the record of a send and then send again, which is the
 * doubling the table exists to prevent.
 *
 * The service role bypasses RLS, so every query through this **must** scope by `family_id`
 * itself — a policy decides what may leave the database and a screen decides whose kitchen it
 * shows, and here there is no policy to fall back on.
 */
import { createClient } from "@supabase/supabase-js";

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
