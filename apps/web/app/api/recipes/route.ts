import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { prepareRecipe } from "@/lib/recipe-input";
import { refusal } from "@/lib/refusal";
import { statusFor, writeChildren } from "@/lib/recipe-writes";

/**
 * Create a recipe from what somebody typed.
 *
 * **Written with the caller's own session, not the service role.** So row-level security is
 * what decides whether it lands, `household_can_write` refuses a lapsed household, and this
 * route has no power its caller does not — the same reasoning as reading.
 *
 * Server-side rather than three inserts from the browser, because the recipe has to exist
 * before its children can reference it and a half-written recipe should not be the user's
 * problem to notice. PostgREST cannot do the three in one statement, so the unwind below is
 * what stands in for a transaction.
 */
export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const prepared = prepareRecipe(body as Record<string, unknown>);
  if (!prepared.ok) return Response.json({ error: prepared.error }, { status: 400 });
  const { recipe } = prepared;

  // An imported recipe arrives with the same fields plus where it came from and, sometimes, an
  // already-uploaded photo. Saving is the *same* route as typing one in on purpose: the review
  // screen hands back text, the parser runs once, and there is no second write path to drift.
  const input = body as { sourceUrl?: unknown; photo?: unknown };
  const sourceUrl = typeof input.sourceUrl === "string" && input.sourceUrl.startsWith("http")
    ? input.sourceUrl.slice(0, 2000)
    : null;
  const photo = readPhoto(input.photo, family.id);

  const created = await supabase
    .from("recipes")
    .insert({
      family_id: family.id,
      title: recipe.title,
      servings: recipe.servings,
      time_minutes: recipe.timeMinutes,
      source_name: recipe.sourceName,
      source_url: sourceUrl,
      times_made: 0,
      status: "active",
      visibility: "private",
      make_again: null,
      created_by: null,
    })
    .select("id")
    .single();

  if (created.error) {
    return Response.json({ error: refusal(created.error) }, { status: statusFor(created.error) });
  }

  const written = await writeChildren(supabase, family.id, created.data.id, recipe);
  if (written) {
    // The recipe exists and its ingredients do not. Tombstoned rather than left as a title with
    // nothing in it — a client cannot hard-delete (grants revoked in 091300), and a tombstone is
    // what a syncing device can see anyway.
    await supabase
      .from("recipes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", created.data.id);
    return Response.json({ error: written }, { status: 400 });
  }

  if (photo) {
    /*
     * The moment the object becomes reachable.
     *
     * Storage read policies resolve through this row (090700), so the bytes uploaded during the
     * preview were readable by nobody until now. `source` is `import` — the original site's
     * photograph, not the household's — which is what keeps it off a published page while the
     * copyright question is open (decisions §17), and provenance is not editable afterwards.
     */
    const { error } = await supabase.from("photos").insert({
      family_id: family.id,
      recipe_id: created.data.id,
      storage_path: photo.storagePath,
      source: "import",
      upload_state: "stored",
      width: photo.width,
      height: photo.height,
    });
    if (error) {
      // the recipe is the point; a photo that will not attach is worth reporting, not unwinding
      console.warn(`[pashki] saved recipe ${created.data.id} without its photo: ${error.message}`);
    }
  }

  return Response.json({ id: created.data.id });
}

/**
 * The photo the preview uploaded, if any.
 *
 * The path is checked against this household's folder before it is trusted: it arrives from the
 * client, and `photos_path_in_household` would refuse a foreign one anyway — but a clear refusal
 * beats a constraint violation, and the check costs one comparison.
 */
function readPhoto(value: unknown, familyId: string) {
  if (typeof value !== "object" || value === null) return null;
  const photo = value as { storagePath?: unknown; width?: unknown; height?: unknown };
  if (typeof photo.storagePath !== "string" || !photo.storagePath.startsWith(`${familyId}/`)) {
    return null;
  }
  return {
    storagePath: photo.storagePath,
    width: Number.isInteger(photo.width) ? (photo.width as number) : null,
    height: Number.isInteger(photo.height) ? (photo.height as number) : null,
  };
}
