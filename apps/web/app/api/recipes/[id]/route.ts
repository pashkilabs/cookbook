import { userClient } from "@/lib/supabase-server";
import { maybeRow, rows } from "@/lib/rows";
import { platformStore } from "@/lib/platform";
import { prepareRecipe } from "@/lib/recipe-input";
import { statusFor, writeChildren , classifyIfUnclassified } from "@/lib/recipe-writes";
import { refusal } from "@/lib/refusal";

/*
 * Splitting a recipe is three model calls and this route has to outlive them.
 *
 * The platform's default cap is well under that, so without this the request is killed before
 * `componentsFor` writes — the calls are paid for and nothing is stored, which reads to the
 * person as "it did not work" and to the provider as three requests that mattered. Sixty is the
 * value the photo reaper already runs at in production, so it is known to be allowed here.
 *
 * The three readings run in parallel, which is what makes sixty enough: the worst case is one
 * sixty-second timeout rather than three in series.
 */
export const maxDuration = 60;

/**
 * Edit or remove one recipe.
 *
 * Both filter by `family_id` as well as by id. RLS would already refuse another household's
 * row, but a published recipe is *readable* across households (decisions §17) and an update
 * that matches nothing returns success with zero rows — so without the filter, editing a
 * stranger's recipe would look like it worked. The row count is checked, not assumed.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const prepared = prepareRecipe(body as Record<string, unknown>);
  if (!prepared.ok) return Response.json({ error: prepared.error }, { status: 400 });
  const { recipe } = prepared;

  const updated = await supabase
    .from("recipes")
    .update({
      title: recipe.title,
      servings: recipe.servings,
      time_minutes: recipe.timeMinutes,
      // correctable here because the review screen only exists at import, and no already-saved
      // recipe will pass through it again — a wrong course would otherwise be permanent on the
      // field the browse picker rests on
      course: recipe.course,
      cuisine: recipe.cuisine,
      dish_form: recipe.dishForm,
      principal_protein: recipe.principalProtein,
      source_name: recipe.sourceName,
    })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id");

  if (updated.error) {
    return Response.json({ error: refusal(updated.error) }, { status: statusFor(updated.error) });
  }
  if (updated.data.length === 0) {
    // no rows: either it is not ours or it is already gone. Same answer for both, which is the
    // same reasoning as the detail screen's 404.
    return Response.json({ error: "no such recipe" }, { status: 404 });
  }

  /**
   * Children are replaced wholesale: tombstone the old rows, insert the new ones.
   *
   * Not a diff. Position is the only identity an ingredient line has, so "line 3 changed" and
   * "a line was inserted above it" are indistinguishable from the text alone — a diff would
   * guess. Tombstoning also happens to be what a syncing device needs: a peer sees rows that
   * went, rather than rows that silently stopped existing (architecture §5).
   */
  const removedAt = new Date().toISOString();
  for (const table of ["recipe_ingredients", "recipe_steps"] as const) {
    const { error } = await supabase
      .from(table)
      .update({ deleted_at: removedAt })
      .eq("recipe_id", id)
      .eq("family_id", familyId)
      .is("deleted_at", null);
    if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  }

  const failure = await writeChildren(supabase, familyId, id, recipe);
  if (failure) return Response.json({ error: failure }, { status: 400 });

  return Response.json({ id });
}

/**
 * Re-classify, only when asked.
 *
 * **Never automatic on edit.** Somebody may have corrected a field by hand, and a model
 * overwriting that is worse than the field being stale — a person who fixes "beef" on a mushroom
 * pasta and watches it come back beef will stop fixing anything. So this is a button, and it
 * clears `classified_at` first so the same guarded path the backfill uses does the work.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  // filtered here as well as by RLS: a policy says what may leave the database, a screen says
  // whose kitchen it shows, and those are different questions
  const owned = await supabase
    .from("recipes")
    .select("id")
    .eq("id", id)
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!owned.data) return Response.json({ error: "no such recipe" }, { status: 404 });

  /*
   * Splitting into components, as a mode on the reclassify button's route (§37's function cap).
   *
   * **Why a POST and not a page render.** Splitting is three model calls and can take a minute
   * against a slow provider. Doing it inside the composer's GET meant a minute of silence, and
   * a minute of silence is how somebody concludes the page has hung and reloads — which started
   * three *fresh* calls, paid twice, and let the second run disagree with the first. Behind an
   * explicit action the problem does not arise: reloading the composer now costs nothing,
   * because the composer no longer infers.
   *
   * The person asked for it, so it is worth the wait; and the client can say what is happening
   * while it runs, which a server render cannot.
   */
  const body = await request.json().catch(() => ({}));
  if ((body as { split?: unknown }).split === true) {
    const ingredients = rows(
      await supabase
        .from("recipe_ingredients")
        .select("item_text, amount, unit, section")
        .eq("recipe_id", id)
        .is("deleted_at", null)
        .order("position"),
      "lines to split",
    );
    const recipe = maybeRow(
      await supabase
        .from("recipes")
        .select("id, title, components, components_key, components_agreement, components_readings")
        .eq("id", id)
        .eq("family_id", family.id)
        .maybeSingle(),
      "recipe to split",
    );
    if (!recipe) return Response.json({ error: "no such recipe" }, { status: 404 });

    const { componentsFor } = await import("@/lib/tastes");
    const split = await componentsFor(supabase, recipe, ingredients);
    if (!split) {
      /*
       * Three outcomes, not two. A reader that could not be reached is not a recipe that has no
       * parts, and telling somebody "this is one thing" when the provider timed out is a
       * confident answer to a question nobody managed to ask.
       */
      return Response.json(
        { error: "nothing came back from the reader — it may be busy. Worth trying again." },
        { status: 503 },
      );
    }
    return Response.json({
      ok: true,
      parts: split.components.length,
      readings: split.readings,
      agreement: split.agreement,
    });
  }

  // asked for explicitly, so the existing values are cleared rather than protected — that is
  // what the button means
  await supabase
    .from("recipes")
    // classified_at too, or the guarded path returns early and the button does nothing
    .update({ course: null, cuisine: null, dish_form: null, principal_protein: null, classified_at: null })
    .eq("id", id);
  await classifyIfUnclassified(supabase, id);

  const after = maybeRow(
    await supabase
    .from("recipes")
    .select("course, cuisine, dish_form, principal_protein")
    .eq("id", id)
    .maybeSingle(),
    "after",
  );
  return Response.json({ ok: true, classification: after ?? null });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scope = await household();
  if ("response" in scope) return scope.response;
  const { supabase, familyId } = scope;

  // A tombstone, not a delete. Clients hold no DELETE privilege (091300) because a hard-deleted
  // row is the one thing a peer cannot tell from a row that never synced.
  //
  // **The children are tombstoned by a database trigger, not here** (decisions §30). That is
  // deliberate and it is invisible from this file, so: `private.propagate_soft_delete` fires on
  // this UPDATE and carries the same timestamp down to plan_entries, shortlist_entries, ratings,
  // photos, recipe_ingredients and recipe_steps. It lives in the database because Phase 3's sync
  // will write `deleted_at` straight into Postgres from a device, without passing through here.
  const { data, error } = await supabase
    .from("recipes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .select("id");

  if (error) return Response.json({ error: refusal(error) }, { status: statusFor(error) });
  if (data.length === 0) return Response.json({ error: "no such recipe" }, { status: 404 });
  return Response.json({ id });
}

async function household() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { response: Response.json({ error: "sign in first" }, { status: 401 }) };
  }
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) {
    return { response: Response.json({ error: "this account has no household" }, { status: 403 }) };
  }
  return { supabase, familyId: family.id };
}
