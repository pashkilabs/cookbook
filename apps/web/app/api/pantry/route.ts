import { userClient } from "@/lib/supabase-server";
import { maybeRow } from "@/lib/rows";
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

  let body: { name?: unknown; fromRecipeId?: unknown; fromComponent?: unknown; batches?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  /*
   * A BASE: a pantry item that remembers which part of which recipe it is (§69).
   *
   * Handled before the ordinary path and returning immediately, because it is a different row —
   * an ordinary pantry item is a flag with no amount, and a base is a *count of batches*, which
   * is what the shopping list decrements instead of an expiry date it would have to guess.
   *
   * The recipe is not checked for ownership here: the composite foreign key
   * `(from_recipe_id, family_id) -> recipes (id, family_id)` refuses another household's at write
   * time, which is a guarantee rather than a line of route code somebody can forget.
   */
  if (body.fromRecipeId !== undefined) {
    const fromRecipeId = typeof body.fromRecipeId === "string" ? body.fromRecipeId : "";
    const fromComponent =
      typeof body.fromComponent === "string" ? body.fromComponent.trim().slice(0, 120) : "";
    const batches = Number(body.batches ?? 1);
    if (!fromRecipeId || !fromComponent) {
      return Response.json(
        { error: "a base needs the recipe it came from and the part it is" },
        { status: 400 },
      );
    }
    if (!Number.isInteger(batches) || batches < 1 || batches > 20) {
      return Response.json({ error: "batches must be a whole number, 1 to 20" }, { status: 400 });
    }

    /*
     * Another batch of the same part adds to what is there rather than making a second row.
     * Two rows for one thing in a freezer is a thing nobody can reconcile, and the shopping
     * list would deduct both.
     */
    const existing = maybeRow(
      await supabase
        .from("pantry_items")
        .select("id, amount")
        .eq("family_id", familyId)
        .eq("from_recipe_id", fromRecipeId)
        .ilike("from_component", fromComponent)
        .is("deleted_at", null)
        .maybeSingle(),
      "existing base",
    );

    if (existing) {
      const { error } = await supabase
        .from("pantry_items")
        .update({ amount: Number(existing.amount ?? 0) + batches })
        .eq("id", existing.id);
      if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
      return Response.json({ kept: fromComponent, batches: Number(existing.amount ?? 0) + batches });
    }

    const { error } = await supabase.from("pantry_items").insert({
      family_id: familyId,
      name,
      ingredient_id: null,
      amount: batches,
      unit: null,
      from_recipe_id: fromRecipeId,
      from_component: fromComponent,
    });
    if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
    return Response.json({ kept: fromComponent, batches });
  }

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
