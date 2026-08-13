import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { createRecipeFrom } from "@/lib/recipe-writes";

/**
 * Create a recipe from what somebody typed — or from a review they just approved.
 *
 * **Written with the caller's own session, not the service role.** So row-level security is
 * what decides whether it lands, `household_can_write` refuses a lapsed household, and this
 * route has no power its caller does not — the same reasoning as reading.
 *
 * The work is in `createRecipeFrom` because accepting a queued import needs exactly this and
 * must not become a second write path. See `lib/recipe-writes.ts`.
 */
export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const created = await createRecipeFrom(supabase, family.id, body as Record<string, unknown>);
  if (!created.ok) return Response.json({ error: created.error }, { status: created.status });
  return Response.json({ id: created.id });
}
