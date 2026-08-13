import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { refusal } from "@/lib/refusal";
import { statusFor } from "@/lib/recipe-writes";

/**
 * What the household already has.
 *
 * `pantry_items` carries an optional amount and unit, and `consolidate()` deducts it when both
 * are known — but the button on a shopping line only says "I have this", with no quantity. So a
 * pantry item created here has no amount, which `consolidate()` treats as "flag it, deduct
 * nothing". That is the honest reading of the gesture: somebody glancing in a cupboard knows
 * they have olive oil, not that they have 340 ml of it.
 *
 * The name is the shopping line's label — the catalog's canonical name — because that is what
 * `consolidate()` matches a pantry entry against.
 */
export async function POST(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  let body: { name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  const existing = await supabase
    .from("pantry_items")
    .select("id")
    .eq("family_id", familyId)
    .ilike("name", name)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.data) return Response.json({ id: existing.data.id });

  const { data, error } = await supabase
    .from("pantry_items")
    .insert({ family_id: familyId, name, ingredient_id: null, amount: null, unit: null })
    .select("id")
    .single();
  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  return Response.json({ id: data.id });
}

export async function DELETE(request: Request) {
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("pantry_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", body.id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id");
  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  if (data.length === 0) return Response.json({ error: "no such pantry item" }, { status: 404 });
  return Response.json({ id: body.id });
}

async function household() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { response: Response.json({ error: "sign in first" }, { status: 401 }) };
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return { response: Response.json({ error: "no household" }, { status: 403 }) };
  return { supabase, familyId: family.id };
}
