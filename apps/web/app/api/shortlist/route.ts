import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { refusal } from "@/lib/refusal";
import { statusFor } from "@/lib/recipe-writes";
import { isIsoDate, startOfWeek } from "@/lib/week";

/**
 * "Make this week" — the shortlist.
 *
 * `shortlist_entries` is what separates browsing from scheduling: a recipe can be wanted this
 * week without yet having a day. The planner shows them waiting, and giving one a day is a
 * separate act.
 *
 * Both verbs are idempotent, because the button they sit behind can be pressed twice on a slow
 * connection. Adding when it is already there answers success; removing what is already gone
 * answers success too — the caller asked for a state, not for an event.
 */
export async function POST(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  const input = await read(request);
  if ("error" in input) return input.error;
  const { recipeId, weekStart } = input;

  // the recipe has to be ours: the composite key on (recipe_id, family_id) refuses another
  // household's, but a clear 404 beats a foreign-key error
  const owned = await supabase
    .from("recipes")
    .select("id")
    .eq("id", recipeId)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!owned.data) return Response.json({ error: "no such recipe" }, { status: 404 });

  const existing = await supabase
    .from("shortlist_entries")
    .select("id")
    .eq("family_id", familyId)
    .eq("week_start", weekStart)
    .eq("recipe_id", recipeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.data) return Response.json({ shortlisted: true, weekStart });

  const { error } = await supabase
    .from("shortlist_entries")
    .insert({ family_id: familyId, week_start: weekStart, recipe_id: recipeId });

  // 23505 is the partial unique index: somebody added it in the moment between the read and the
  // write, which is the state the caller wanted anyway
  if (error && error.code !== "23505") {
    return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  }
  return Response.json({ shortlisted: true, weekStart });
}

export async function DELETE(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  const input = await read(request);
  if ("error" in input) return input.error;
  const { recipeId, weekStart } = input;

  const { error } = await supabase
    .from("shortlist_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("family_id", familyId)
    .eq("week_start", weekStart)
    .eq("recipe_id", recipeId)
    .is("deleted_at", null);
  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });

  return Response.json({ shortlisted: false, weekStart });
}

async function read(request: Request) {
  let body: { recipeId?: unknown; weekStart?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return { error: Response.json({ error: "expected a JSON body" }, { status: 400 }) };
  }
  if (typeof body.recipeId !== "string") {
    return { error: Response.json({ error: "recipeId is required" }, { status: 400 }) };
  }
  if (!isIsoDate(body.weekStart)) {
    return { error: Response.json({ error: "weekStart must be a calendar date" }, { status: 400 }) };
  }
  // normalised, so a Wednesday sent by a caller shortlists the week rather than inventing one
  return { recipeId: body.recipeId, weekStart: startOfWeek(body.weekStart) };
}

async function household() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { response: Response.json({ error: "sign in first" }, { status: 401 }) };
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return { response: Response.json({ error: "no household" }, { status: 403 }) };
  return { supabase, familyId: family.id };
}
