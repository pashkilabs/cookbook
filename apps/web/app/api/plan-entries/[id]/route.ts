import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { refusal } from "@/lib/refusal";
import { statusFor } from "@/lib/recipe-writes";
import { isScale } from "@/lib/planner";

/** Change how much to cook, or take it off the day. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  let body: { scale?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const scale = Number(body.scale);
  if (!isScale(scale)) return Response.json({ error: "scale must be 1, 1.5 or 2" }, { status: 400 });

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
  return Response.json({ id, scale });
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
