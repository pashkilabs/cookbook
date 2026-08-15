import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { refusal } from "@/lib/refusal";
import { statusFor } from "@/lib/recipe-writes";
import { MAX_SERVINGS, parseScale, parseServings, scaleForServings, servingsForScale } from "@/lib/planner";

/** Change how much to cook, or take it off the day. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  let body: { servings?: unknown; scale?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  /*
   * The recipe's own yield is needed to turn a servings figure into the stored multiplier, and it
   * is read through the entry so the household scope is never taken from the caller.
   */
  const entry = await supabase
    .from("plan_entries")
    .select("id, recipes!inner(servings)")
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!entry.data) return Response.json({ error: "no such entry" }, { status: 404 });
  const recipeServings = (entry.data.recipes as unknown as { servings: number | null }).servings;

  let scale: number | null;
  if (body.servings !== undefined) {
    const servings = parseServings(body.servings);
    scale = servings === null ? null : scaleForServings(servings, recipeServings);
  } else {
    scale = parseScale(body.scale);
  }
  if (scale === null) {
    return Response.json(
      {
        error: recipeServings
          ? `servings must be a whole number of people, 1 to ${MAX_SERVINGS}`
          : "this recipe does not say what it serves, so send a batch multiplier",
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("plan_entries")
    .update({ scale })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id");
  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  // an update matching nothing returns success with zero rows, so the count is what says whether
  // it was ours — the same reasoning as editing a recipe
  if (data.length === 0) return Response.json({ error: "no such entry" }, { status: 404 });
  return Response.json({ id, scale, servings: servingsForScale(scale, recipeServings) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  const { data, error } = await supabase
    .from("plan_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id");
  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  if (data.length === 0) return Response.json({ error: "no such entry" }, { status: 404 });
  return Response.json({ id });
}

async function household() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { response: Response.json({ error: "sign in first" }, { status: 401 }) };
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return { response: Response.json({ error: "no household" }, { status: 403 }) };
  return { supabase, familyId: family.id };
}
