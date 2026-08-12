import type { SupabaseClient } from "@supabase/supabase-js";
import type { TokenAuthenticator } from "./http.js";

/**
 * Resolves a bearer token to an account id by asking Supabase Auth.
 *
 * Not by verifying the JWT locally, which would work and is tempting. Asking the auth
 * server means **no component here holds the JWT secret**, and a session that has been
 * revoked stops working immediately rather than at its expiry — which is what "sign out
 * everywhere" has to mean.
 *
 * The cost is a network call per request. Worth it: the alternative is a secret in one
 * more place and a revocation list to maintain.
 *
 * Returns null for anything that does not resolve, and never throws for a bad token —
 * an invalid token is an ordinary outcome. A transport failure does throw, so the
 * router can answer 503 rather than telling the caller their token is bad.
 */
export function createSupabaseAuthenticator(supabase: SupabaseClient): TokenAuthenticator {
  return {
    async authenticate(bearerToken: string): Promise<string | null> {
      const { data, error } = await supabase.auth.getUser(bearerToken);
      if (error) {
        // Supabase reports a rejected token as an error rather than an empty user, so
        // the distinction has to be drawn on the status: 4xx is the token's fault, and
        // anything else is ours and should surface as a failure.
        const status = (error as { status?: number }).status ?? 401;
        if (status >= 400 && status < 500) return null;
        throw error;
      }
      return data.user?.id ?? null;
    },
  };
}
