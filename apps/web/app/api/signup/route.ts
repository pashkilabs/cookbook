import { anonAuth } from "@/lib/auth-anon";
import { createRateLimiter } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";

/**
 * Sign up: send a confirmation email. Create nothing else.
 *
 * No account row, no household, no membership — those wait for the address to be proven, in
 * `lib/provisioning.ts`. What exists after this call is an unconfirmed auth user, and GoTrue
 * will not issue a session for one.
 *
 * **The response is identical whether the address is new or already registered.** A signup
 * form that answers differently is an address-enumeration oracle, and on a household app
 * "is this person a customer" is exactly what it must not tell a stranger. Every path below
 * that depends on the address returns the same 202 and the same body.
 *
 * The honest limit of that: the anon key is public, so Supabase's own `/auth/v1/signup` is
 * reachable directly and answers with `identities: []` for an address that already exists.
 * This closes *our* surface, which is the part we own. The other one is a Supabase setting
 * rather than our code, and it belongs on the list for opening public signup.
 */
const perAddress = createRateLimiter({ limit: 2, windowSeconds: 3600 });

export async function POST(request: Request) {
  let body: { email?: string; password?: string; householdName?: string; displayName?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const householdName = body.householdName?.trim();
  const displayName = body.displayName?.trim();

  // Validated before the address is used for anything, so a rejection here says something
  // about the request and nothing about the address.
  if (!email || !password || !householdName || !displayName) {
    return Response.json(
      { error: "email, password, householdName and displayName are all required" },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const accepted = () =>
    Response.json(
      {
        status: "confirmation-sent",
        message:
          "Check your email for a confirmation link. No household is created until you follow it.",
      },
      { status: 202 },
    );

  // Our own limit, on top of Supabase's 2-per-hour. Ours is keyed by address and theirs by
  // project, so this stops one person spending the whole project's budget.
  if (!perAddress.check(email).allowed) return accepted();

  const { error } = await anonAuth().auth.signUp({
    email,
    password,
    options: {
      // read back at first confirmed sign-in; see lib/provisioning.ts
      data: { household_name: householdName, display_name: displayName },
      emailRedirectTo: `${siteUrl()}/sign-in`,
    },
  });

  if (error) {
    // Deliberately swallowed. An error here is "already registered", "rate limited" or a mail
    // failure, and telling those apart for the caller is the oracle. Logged for us, identical
    // for them.
    console.warn(`[pashki] signUp did not send for a submitted address: ${error.message}`);
  }

  return accepted();
}
