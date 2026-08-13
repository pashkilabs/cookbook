import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { refusal } from "@/lib/refusal";
import { statusFor } from "@/lib/recipe-writes";
import { findOrCreateWeek, isScale } from "@/lib/planner";
import { isIsoDate, startOfWeek } from "@/lib/week";

/**
 * Give a recipe a day.
 *
 * The week's `meal_plans` row is created on demand — a household that never opens the planner
 * should not accumulate empty weeks, and the first placement is the moment the week becomes real.
 *
 * `week_start` is derived from the date rather than taken from the caller. Sending both would
 * let them disagree, and `plan_entries` has no constraint tying an entry's date to its plan's
 * week: the composite key ties it to the *household*, not the week. So the one source is the day
 * being planned.
 */
export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "no household" }, { status: 403 });

  let body: { recipeId?: unknown; date?: unknown; scale?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (typeof body.recipeId !== "string") {
    return Response.json({ error: "recipeId is required" }, { status: 400 });
  }
  if (!isIsoDate(body.date)) {
    return Response.json({ error: "date must be a calendar date" }, { status: 400 });
  }
  const scale = body.scale === undefined ? 1 : Number(body.scale);
  if (!isScale(scale)) {
    return Response.json({ error: "scale must be 1, 1.5 or 2" }, { status: 400 });
  }

  const owned = await supabase
    .from("recipes")
    .select("id")
    .eq("id", body.recipeId)
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!owned.data) return Response.json({ error: "no such recipe" }, { status: 404 });

  const week = await findOrCreateWeek(supabase, family.id, startOfWeek(body.date));
  if ("message" in week) {
    return Response.json({ error: refusal(week) }, { status: statusFor(week) });
  }

  const { data, error } = await supabase
    .from("plan_entries")
    .insert({
      family_id: family.id,
      meal_plan_id: week.id,
      date: body.date,
      recipe_id: body.recipeId,
      scale,
      cooked_at: null,
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });

  // Placing it takes it off the shortlist: it is no longer waiting for a day. Best effort — a
  // failure here leaves it listed twice, which is untidy rather than wrong.
  await supabase
    .from("shortlist_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("family_id", family.id)
    .eq("week_start", startOfWeek(body.date))
    .eq("recipe_id", body.recipeId)
    .is("deleted_at", null);

  return Response.json({ id: data.id });
}
