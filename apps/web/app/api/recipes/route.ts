import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { prepareRecipe } from "@/lib/recipe-input";
import { refusal } from "@/lib/refusal";
import { statusFor, writeChildren } from "@/lib/recipe-writes";

/**
 * Create a recipe from what somebody typed.
 *
 * **Written with the caller's own session, not the service role.** So row-level security is
 * what decides whether it lands, `household_can_write` refuses a lapsed household, and this
 * route has no power its caller does not — the same reasoning as reading.
 *
 * Server-side rather than three inserts from the browser, because the recipe has to exist
 * before its children can reference it and a half-written recipe should not be the user's
 * problem to notice. PostgREST cannot do the three in one statement, so the unwind below is
 * what stands in for a transaction.
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

  const prepared = prepareRecipe(body as Record<string, unknown>);
  if (!prepared.ok) return Response.json({ error: prepared.error }, { status: 400 });
  const { recipe } = prepared;

  const created = await supabase
    .from("recipes")
    .insert({
      family_id: family.id,
      title: recipe.title,
      servings: recipe.servings,
      time_minutes: recipe.timeMinutes,
      source_name: recipe.sourceName,
      source_url: null,
      times_made: 0,
      status: "active",
      visibility: "private",
      make_again: null,
      created_by: null,
    })
    .select("id")
    .single();

  if (created.error) {
    return Response.json({ error: refusal(created.error) }, { status: statusFor(created.error) });
  }

  const written = await writeChildren(supabase, family.id, created.data.id, recipe);
  if (written) {
    // The recipe exists and its ingredients do not. Tombstoned rather than left as a title with
    // nothing in it — a client cannot hard-delete (grants revoked in 091300), and a tombstone is
    // what a syncing device can see anyway.
    await supabase
      .from("recipes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", created.data.id);
    return Response.json({ error: written }, { status: 400 });
  }

  return Response.json({ id: created.data.id });
}
