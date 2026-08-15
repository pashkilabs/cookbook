import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { refusal } from "@/lib/refusal";
import { statusFor } from "@/lib/recipe-writes";
import {
  MAX_SERVINGS,
  findOrCreateWeek,
  parseScale,
  parseServings,
  scaleForServings,
  servingsForScale,
} from "@/lib/planner";
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
/** Servings when the recipe can express them, a multiplier when it cannot. */
function readScale(
  body: { servings?: unknown; scale?: unknown },
  recipeServings: number | null,
): number | null {
  if (body.servings !== undefined) {
    const servings = parseServings(body.servings);
    return servings === null ? null : scaleForServings(servings, recipeServings);
  }
  if (body.scale !== undefined) return parseScale(body.scale);
  // nothing asked for: one batch, which is what the recipe already says it feeds
  return 1;
}

export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "no household" }, { status: 403 });

  let body: {
    recipeId?: unknown;
    date?: unknown;
    servings?: unknown;
    scale?: unknown;
    /** "yes, two entries, I meant it" */
    force?: unknown;
  };
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
  const owned = await supabase
    .from("recipes")
    .select("id, title, servings")
    .eq("id", body.recipeId)
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!owned.data) return Response.json({ error: "no such recipe" }, { status: 404 });

  /*
   * Servings in, multiplier stored.
   *
   * `scale` is still what `plan_entries` holds and what `packages/core` consolidates against —
   * this only inverts the arithmetic the planner was already doing to *display* servings.
   * Decisions §41.
   *
   * A recipe with no stated yield cannot answer "feed six", so the caller sends a multiplier
   * instead. Two shapes, because there are genuinely two questions and answering the second with
   * an invented yield of 1 would multiply everything by six.
   */
  const scale = readScale(body, owned.data.servings);
  if (scale === null) {
    return Response.json(
      {
        error: owned.data.servings
          ? `servings must be a whole number of people, 1 to ${MAX_SERVINGS}`
          : "this recipe does not say what it serves, so send a batch multiplier",
      },
      { status: 400 },
    );
  }

  /*
   * Already on that day.
   *
   * Not refused and not silently merged: the caller is told, and given the entry so it can offer
   * to feed more people instead. Two entries stay *possible* — decisions §41 — because a
   * household cooking the same thing twice in a day is real and the planner has no concept of
   * meals to express it with.
   */
  const already = await supabase
    .from("plan_entries")
    .select("id, scale")
    .eq("family_id", family.id)
    .eq("recipe_id", body.recipeId)
    .eq("date", body.date)
    .is("deleted_at", null)
    .maybeSingle();

  if (already.data && body.force !== true) {
    return Response.json(
      {
        error: "already-planned",
        existing: {
          id: already.data.id,
          scale: Number(already.data.scale),
          servings: servingsForScale(Number(already.data.scale), owned.data.servings),
        },
        recipe: { title: owned.data.title, servings: owned.data.servings },
      },
      { status: 409 },
    );
  }

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
