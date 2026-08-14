import { createClient } from "@supabase/supabase-js";
import { createPlatformClient, createPlatformRouter } from "@pashki/platform-client";
import { createSupabaseAuthenticator } from "@pashki/platform-client/auth";
import { createSupabasePlatformStore } from "@pashki/platform-client/supabase";
import { createEd25519Signer } from "@pashki/platform-client/crypto";

/**
 * Server-only wiring for the seam. Importing this from a client component fails
 * `pnpm check:boundaries`, which is the point.
 *
 * The service-role client is built per call rather than held in a module-level constant:
 * a route handler in a serverless runtime may be recycled between requests, and a client
 * captured at import time outlives the environment it read its key from.
 */
function serviceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function signer() {
  const keyId = process.env.PASHKI_TOKEN_KEY_ID;
  const privateKeyPem = process.env.PASHKI_TOKEN_PRIVATE_KEY;
  if (!keyId || !privateKeyPem) {
    throw new Error("PASHKI_TOKEN_KEY_ID and PASHKI_TOKEN_PRIVATE_KEY are required");
  }
  return createEd25519Signer({ keyId, privateKeyPem });
}

/**
 * The seam for one signed-in account.
 *
 * Account-scoped rather than family-scoped on purpose: every method resolves the household from
 * the account, so a route handler never holds a `familyId` it could be talked into substituting.
 * No signer — nothing here mints a token.
 */
export function platformClient(accountId: string) {
  return createPlatformClient({ store: platformStore(), accountId });
}

export function platformStore() {
  return createSupabasePlatformStore(serviceRole());
}

/**
 * The framework-agnostic router, unchanged, with a Supabase authenticator in front.
 *
 * Not reimplemented as Next.js handlers: the router already decides the routes, the
 * status codes and — the part that matters — that the account comes from the bearer token
 * and from no parameter anywhere. A second implementation would be a second chance to get
 * that wrong.
 */
export function platformRouter() {
  const admin = serviceRole();
  const store = createSupabasePlatformStore(admin);
  const sign = signer();
  return createPlatformRouter({
    authenticator: createSupabaseAuthenticator(admin),
    clientFor: (accountId) => createPlatformClient({ store, accountId, signer: sign }),
  });
}
