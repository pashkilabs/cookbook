import { createClient } from "@supabase/supabase-js";
import { platformStore } from "@/lib/platform";

/**
 * Sign up: create the auth user, then the account, household and membership.
 *
 * All of it server-side, because the last three are platform tables and clients have no
 * write path to them (decisions §16). This is the first caller of that path outside test
 * fixtures.
 *
 * **The user is created already confirmed, which is a deliberate Phase 2 shortcut.** Real
 * public signup needs an email confirmation flow; without one, anybody can claim any
 * address. It is recorded here rather than in a backlog because the line that does it is
 * one line, and whoever opens signup to the public has to see it.
 */
export async function POST(request: Request) {
  let body: { email?: string; password?: string; householdName?: string; displayName?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const email = body.email?.trim();
  const password = body.password;
  const householdName = body.householdName?.trim();
  const displayName = body.displayName?.trim();

  if (!email || !password || !householdName || !displayName) {
    return Response.json(
      { error: "email, password, householdName and displayName are all required" },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const user = await admin.auth.admin.createUser({
    email,
    password,
    // Phase 2 shortcut — see above.
    email_confirm: true,
  });
  if (user.error || !user.data.user) {
    // the message is the auth server's, which distinguishes "already registered" from a
    // weak password. Not rewritten, because guessing at it would be worse.
    return Response.json({ error: user.error?.message ?? "could not create the account" }, { status: 400 });
  }

  try {
    const provisioned = await platformStore().provisionHousehold({
      accountId: user.data.user.id,
      email,
      householdName,
      displayName,
    });
    return Response.json({
      familyId: provisioned.family.id,
      created: provisioned.created,
    });
  } catch (thrown) {
    // The auth user exists and has no household. Provisioning is idempotent, so signing in
    // and retrying completes it rather than duplicating — which is why this does not try to
    // delete the user and unwind.
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    return Response.json({ error: `account created but household provisioning failed: ${detail}` }, { status: 500 });
  }
}
