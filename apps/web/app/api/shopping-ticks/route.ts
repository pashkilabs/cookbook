import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { refusal } from "@/lib/refusal";
import { statusFor } from "@/lib/recipe-writes";
import { isIsoDate, startOfWeek } from "@/lib/week";

/**
 * What is already in the trolley.
 *
 * Idempotent both ways, because this is a checkbox somebody taps while walking: tapping twice on
 * a slow connection must not leave the list disagreeing with itself. The caller is asking for a
 * state, not sending an event.
 */
export async function POST(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;
  const input = await read(request);
  if ("error" in input) return input.error;

  const existing = await supabase
    .from("shopping_ticks")
    .select("id")
    .eq("family_id", familyId)
    .eq("week_start", input.weekStart)
    .eq("item_key", input.itemKey)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.data) return Response.json({ ticked: true });

  const { error } = await supabase.from("shopping_ticks").insert({
    family_id: familyId,
    week_start: input.weekStart,
    item_key: input.itemKey,
  });
  // 23505 is the partial unique index: somebody ticked it in the moment between the read and the
  // write, which is the state being asked for anyway
  if (error && error.code !== "23505") {
    return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  }
  return Response.json({ ticked: true });
}

export async function DELETE(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;
  const input = await read(request);
  if ("error" in input) return input.error;

  const { error } = await supabase
    .from("shopping_ticks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("family_id", familyId)
    .eq("week_start", input.weekStart)
    .eq("item_key", input.itemKey)
    .is("deleted_at", null);
  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  return Response.json({ ticked: false });
}

async function read(request: Request) {
  let body: { weekStart?: unknown; itemKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return { error: Response.json({ error: "expected a JSON body" }, { status: 400 }) };
  }
  if (!isIsoDate(body.weekStart)) {
    return { error: Response.json({ error: "weekStart must be a calendar date" }, { status: 400 }) };
  }
  if (typeof body.itemKey !== "string" || body.itemKey.trim() === "") {
    return { error: Response.json({ error: "itemKey is required" }, { status: 400 }) };
  }
  return { weekStart: startOfWeek(body.weekStart), itemKey: body.itemKey.trim().slice(0, 200) };
}

async function household() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { response: Response.json({ error: "sign in first" }, { status: 401 }) };
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return { response: Response.json({ error: "no household" }, { status: 403 }) };
  return { supabase, familyId: family.id };
}
