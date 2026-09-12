import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { refusal } from "@/lib/refusal";
import { findOrCreateWeek } from "@/lib/planner";
import { isIsoDate, startOfWeek } from "@/lib/week";
import { statusFor } from "@/lib/recipe-writes";
import { MAX_SERVINGS, parseScale, parseServings, scaleForServings, servingsForScale } from "@/lib/planner";

/** Change how much to cook, or take it off the day. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  let body: { servings?: unknown; scale?: unknown; date?: unknown; cooked?: unknown };
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
    .select("id, scale, recipes!inner(servings)")
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!entry.data) return Response.json({ error: "no such entry" }, { status: 404 });
  const recipeServings = (entry.data.recipes as unknown as { servings: number | null }).servings;

  /*
   * Recording that the meal was cooked — the shortest of the three intents, and the one this
   * route existed without for the whole life of the app.
   *
   * Handled before the scale branch and returning immediately: marking cooked says nothing
   * about how much was made, and falling through to the servings validation is what made a
   * move-only request answer 400. Three intents through one handler was already one too many.
   *
   * `cooked_at` is set to `now()` by the database rather than a timestamp from here: a client
   * clock can be minutes out, and a meal recorded in the future is a meal the planner will show
   * as not yet eaten.
   */
  if (body.cooked !== undefined) {
    const { data, error } = await supabase
      .from("plan_entries")
      .update({ cooked_at: body.cooked === true ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .select("id, cooked_at");
    if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
    if (data.length === 0) return Response.json({ error: "no such entry" }, { status: 404 });
    return Response.json({ id, cookedAt: data[0]!.cooked_at });
  }

  /*
   * A move changes the day and nothing else.
   *
   * Asking for neither servings nor a multiplier used to fall through to `parseScale(undefined)`
   * and answer 400 — so dragging a meal to another day, which sends only a date, was refused by
   * the branch that validates how much of it to cook. Three intents through one handler, and
   * only two of them had been written.
   */
  let scale: number | null;
  if (body.servings !== undefined) {
    const servings = parseServings(body.servings);
    scale = servings === null ? null : scaleForServings(servings, recipeServings);
  } else if (body.scale !== undefined) {
    scale = parseScale(body.scale);
  } else {
    scale = Number(entry.data.scale);
  }
  if (scale === null || !Number.isFinite(scale)) {
    return Response.json(
      {
        error: recipeServings
          ? `servings must be a whole number of people, 1 to ${MAX_SERVINGS}`
          : "this recipe does not say what it serves, so send a batch multiplier",
      },
      { status: 400 },
    );
  }

  /*
   * Moving a meal to another day — and, when that day is in another week, to another plan.
   *
   * `meal_plan_id` has to move with the date. Nothing in the schema ties an entry's date to its
   * plan's week (the composite key ties it to the *household*), so an entry left pointing at
   * last week's plan would still render under last week while claiming next Tuesday — each half
   * consistent and the join wrong. `findOrCreateWeek` is the same call the create path makes,
   * so a week becomes real the same way whichever door it arrives through.
   */
  let moveTo: { date: string; meal_plan_id: string } | null = null;
  if (body.date !== undefined) {
    if (typeof body.date !== "string" || !isIsoDate(body.date)) {
      return Response.json({ error: "a date must be yyyy-mm-dd" }, { status: 400 });
    }
    const week = await findOrCreateWeek(supabase, familyId, startOfWeek(body.date));
    if ("message" in week) {
      return Response.json({ error: refusal(week) }, { status: statusFor(week) });
    }
    moveTo = { date: body.date, meal_plan_id: week.id };
  }

  const { data, error } = await supabase
    .from("plan_entries")
    .update({ scale, ...(moveTo ?? {}) })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id");
  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  // an update matching nothing returns success with zero rows, so the count is what says whether
  // it was ours — the same reasoning as editing a recipe
  if (data.length === 0) return Response.json({ error: "no such entry" }, { status: 404 });
  return Response.json({ id, scale, servings: servingsForScale(scale, recipeServings), ...(moveTo ?? {}) });
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
    .select("id, date, recipe_id");
  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  if (data.length === 0) return Response.json({ error: "no such entry" }, { status: 404 });

  /*
   * Taking a meal off a day returns it to the week's waiting list; it does not un-want it.
   *
   * reported: removing a planned meal deleted it, and the recipe vanished from the week
   * entirely — so a person rearranging Tuesday lost the meal rather than moving it, and the
   * only way back was to find the recipe again. The two acts are different and the model
   * already had both: `shortlist_entries` is "wanted this week, no day yet" and `plan_entries`
   * is "has a day". Removing the day should land in the first, and removing it from the waiting
   * list is what drops it from the week.
   *
   * Idempotent for the same reason the shortlist's own POST is — 23505 is the partial unique
   * index, meaning it is already waiting, which is the state being asked for.
   */
  const removed = data[0]!;
  const back = await supabase.from("shortlist_entries").insert({
    family_id: familyId,
    week_start: startOfWeek(removed.date as string),
    recipe_id: removed.recipe_id as string,
  });
  const waiting = !back.error || back.error.code === "23505";
  if (!waiting) {
    // the meal is off the day either way; say what did not happen rather than imply it did
    console.warn(`[pashki] plan entry ${id} removed but not returned to the waiting list: ${back.error?.message}`);
  }
  return Response.json({ id, waiting });
}

async function household() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { response: Response.json({ error: "sign in first" }, { status: 401 }) };
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return { response: Response.json({ error: "no household" }, { status: 403 }) };
  return { supabase, familyId: family.id };
}
