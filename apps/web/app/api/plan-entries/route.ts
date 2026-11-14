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
    /** breakfast / lunch / dinner / snack — see below for why it is optional */
    slot?: unknown;
    /** the cooked entry this is a leftover of — see below */
    leftoverOf?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  /*
   * ---------------------------------------------------------------------------
   * A leftover: the same row shape, pointing at the meal it came from
   * ---------------------------------------------------------------------------
   *
   * The recipe is **derived from the parent, never sent**. That is what "it points at the same
   * recipe through its parent" means as a rule rather than a hope: a caller cannot log Tuesday's
   * lasagne as a leftover of Tuesday's curry, because there is no field in which to say so.
   *
   * `recipeId` therefore stops being required when `leftoverOf` is present, and passing both is
   * refused rather than ignored — a caller sending a recipe that disagrees with the parent has
   * misunderstood something, and silently preferring one is how two sources of truth begin.
   *
   * **The parent must have been cooked.** The entry point is after the meal, not while planning
   * it: "log leftovers" is retrospective. Planning for leftovers in advance ("this makes six,
   * we're four") is a different feature — it needs a portions model this one deliberately has
   * not got — and it is named here so that the next person reaches for it by name rather than by
   * widening this.
   */
  const leftoverOf = body.leftoverOf === undefined || body.leftoverOf === null ? null : body.leftoverOf;
  if (leftoverOf !== null && typeof leftoverOf !== "string") {
    return Response.json({ error: "leftoverOf must be a plan entry id" }, { status: 400 });
  }
  if (leftoverOf !== null && body.recipeId !== undefined) {
    return Response.json(
      { error: "a leftover takes its recipe from the meal it came from, so do not send recipeId" },
      { status: 400 },
    );
  }
  if (leftoverOf === null && typeof body.recipeId !== "string") {
    return Response.json({ error: "recipeId is required" }, { status: 400 });
  }
  if (!isIsoDate(body.date)) {
    return Response.json({ error: "date must be a calendar date" }, { status: 400 });
  }
  /*
   * No quantity, and said out loud rather than ignored.
   *
   * §3 of the brief is explicit: a leftover exists or it does not. Accepting a scale and storing
   * 1 anyway would be a control that appears to work — the shape this project keeps paying for —
   * so a caller that sends one is told the feature does not exist instead.
   */
  if (leftoverOf !== null && (body.scale !== undefined || body.servings !== undefined)) {
    return Response.json(
      { error: "a leftover has no quantity — it is the meal that was already cooked" },
      { status: 400 },
    );
  }

  let parent: { id: string; recipe_id: string } | null = null;
  if (leftoverOf !== null) {
    const found = await supabase
      .from("plan_entries")
      .select("id, recipe_id, cooked_at, leftover_of")
      .eq("id", leftoverOf)
      .eq("family_id", family.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!found.data) return Response.json({ error: "no such meal" }, { status: 404 });
    if (found.data.leftover_of !== null) {
      // the database refuses this too; answering here makes it a sentence rather than a 500
      return Response.json(
        { error: "a leftover points at the meal that was cooked, not at another leftover" },
        { status: 400 },
      );
    }
    if (found.data.cooked_at === null) {
      return Response.json(
        { error: "there are no leftovers until the meal has been cooked" },
        { status: 400 },
      );
    }
    parent = { id: found.data.id as string, recipe_id: found.data.recipe_id as string };
  }
  const recipeId = parent ? parent.recipe_id : (body.recipeId as string);

  /*
   * ---------------------------------------------------------------------------
   * The slot, which has existed in the database since §slot and never been written
   * ---------------------------------------------------------------------------
   *
   * `plan_entries.slot` is `not null default 'dinner'` with a CHECK of breakfast / lunch /
   * dinner / snack, and **every one of the 40 live entries is 'dinner'** — because this route has
   * never sent the column and the default has been doing all the work. A column nothing writes is
   * the quiet half of §54's *a schema field is not a request*: it is not wrong, it is unexercised.
   *
   * Optional rather than required, because omitting it must keep meaning "dinner" — the planner,
   * the recipe page's plan-it panel and `CookTonight` all post without one, and making it
   * mandatory would break three working paths to serve one new screen.
   *
   * Validated against the list rather than passed through, so a bad value is a 400 here instead
   * of a CHECK violation surfacing as a 500 somewhere downstream — and the list is spelled out
   * rather than imported, because the database owns it and a second copy that drifts is worse
   * than a literal that is obviously local.
   */
  const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
  if (body.slot !== undefined && !SLOTS.includes(body.slot as (typeof SLOTS)[number])) {
    return Response.json({ error: `slot must be one of ${SLOTS.join(", ")}` }, { status: 400 });
  }
  const slot = (body.slot as (typeof SLOTS)[number] | undefined) ?? "dinner";
  const owned = await supabase
    .from("recipes")
    .select("id, title, servings")
    .eq("id", recipeId)
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
    .eq("recipe_id", recipeId)
    .eq("date", body.date)
    /*
     * Per (date, slot), because `(date, slot) IS the meal` — the migration says so in a heading.
     * Porridge at breakfast and a rice pudding at dinner on one Sunday are two meals that happen
     * to share a recipe, and refusing the second as "already planned" would be treating a day as
     * a meal. This check previously had no slot because nothing wrote one.
     */
    .eq("slot", slot)
    .is("deleted_at", null)
    .maybeSingle();

  /*
   * The duplicate offer is about **scaling**, so it has nothing to say about a leftover.
   *
   * "Already planned — feed more people instead?" answers a question a leftover cannot ask: there
   * is no quantity to raise. What *is* worth refusing is the same leftover logged twice onto one
   * meal, and that is a partial unique index in the migration rather than a branch here — the
   * database is where "this row already exists" belongs.
   */
  if (already.data && body.force !== true && leftoverOf === null) {
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
      recipe_id: recipeId,
      slot,
      /* a leftover has no batch multiplier; the cook it came from carried one */
      scale: leftoverOf === null ? scale : 1,
      cooked_at: null,
      leftover_of: leftoverOf,
    })
    .select("id")
    .single();
  if (error) {
    /*
     * `refusal()` reads `23505` as *"somebody else changed that at the same moment"*, which is
     * true of every other unique index here and false of this one: the one-leftover-per-slot
     * index fires on a **second tap**, where nobody changed anything and reloading would show
     * the same thing. The shared translator cannot know which index refused; the route can.
     */
    if (leftoverOf !== null && error.code === "23505") {
      return Response.json(
        { error: "those leftovers are already on that meal" },
        { status: 409 },
      );
    }
    return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  }

  // Placing it takes it off the shortlist: it is no longer waiting for a day. Best effort — a
  // failure here leaves it listed twice, which is untidy rather than wrong.
  //
  // Not for a leftover: the shortlist is a list of things waiting to be *cooked*, and eating
  // Tuesday's dinner again on Thursday is not a cook. In practice the entry is already gone,
  // since the parent was planned and cooked — so this is about what the rule says, not what it
  // would do today.
  if (leftoverOf === null) await supabase
    .from("shortlist_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("family_id", family.id)
    .eq("week_start", startOfWeek(body.date))
    .eq("recipe_id", recipeId)
    .is("deleted_at", null);

  return Response.json({ id: data.id });
}
