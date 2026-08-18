import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { createRecipeFrom, attachRecipePhoto } from "@/lib/recipe-writes";

/**
 * Create a recipe from what somebody typed — or from a review they just approved.
 *
 * **Written with the caller's own session, not the service role.** So row-level security is
 * what decides whether it lands, `household_can_write` refuses a lapsed household, and this
 * route has no power its caller does not — the same reasoning as reading.
 *
 * The work is in `createRecipeFrom` because accepting a queued import needs exactly this and
 * must not become a second write path. See `lib/recipe-writes.ts`.
 */
/** the client downscales to ~1500px before sending, so this refuses an unresized upload */
const MAX_PHOTO_BYTES = 4_500_000;

export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  /*
   * A photograph, as a mode on this route rather than a route of its own — twelve serverless
   * functions is the host's limit and a deployment has already been refused for exceeding it
   * (§37). Multipart says which: JSON creates a recipe, a form attaches a picture to one.
   */
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "that upload could not be read" }, { status: 400 });
    }
    const recipeId = String(form.get("recipeId") ?? "").trim();
    const file = form.get("photo");
    if (!recipeId || !(file instanceof File)) {
      return Response.json({ error: "a recipeId and a photo are both required" }, { status: 400 });
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return Response.json(
        { error: `that photo is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${MAX_PHOTO_BYTES / 1e6} MB` },
        { status: 413 },
      );
    }
    const attached = await attachRecipePhoto(
      supabase,
      family.id,
      recipeId,
      new Uint8Array(await file.arrayBuffer()),
    );
    return attached.ok
      ? Response.json({ ok: true })
      : Response.json({ error: attached.error }, { status: attached.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const created = await createRecipeFrom(supabase, family.id, body as Record<string, unknown>);
  if (!created.ok) return Response.json({ error: created.error }, { status: created.status });
  return Response.json({ id: created.id });
}
