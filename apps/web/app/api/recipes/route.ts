import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { createRecipeFrom, attachRecipePhoto, classifyIfUnclassified } from "@/lib/recipe-writes";
import { createBlendFrom, type RequestedPart } from "@/lib/blends";

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
    // "source" means a photograph of the recipe itself — the card it was read from
    const kind = String(form.get("source") ?? "") === "source" ? "source" : "camera";
    const attached = await attachRecipePhoto(
      supabase,
      family.id,
      recipeId,
      new Uint8Array(await file.arrayBuffer()),
      kind,
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

  /*
   * A blend, as a third mode on this route rather than a route of its own — the host caps
   * serverless functions at twelve and a deployment has already been refused for exceeding it
   * (§37). A `blend` key says which: JSON with one creates a lineage, JSON without one creates
   * an ordinary recipe, multipart attaches a photograph.
   *
   * It does not go through `createRecipeFrom`: a blend's ingredients are read from its sources
   * here rather than parsed from what a client sent, so there is no text to prepare and nothing
   * for `prepareRecipe` to validate. Sharing the function would mean a `blend` branch inside it
   * doing none of its work.
   */
  const blend = (body as { blend?: unknown }).blend;
  if (blend !== undefined) {
    const parsed = readBlend(blend);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    const madeBlend = await createBlendFrom(supabase, family.id, parsed.value);
    return madeBlend.ok
      ? Response.json({ id: madeBlend.id })
      : Response.json({ error: madeBlend.error }, { status: madeBlend.status });
  }

  const created = await createRecipeFrom(supabase, family.id, body as Record<string, unknown>);
  if (!created.ok) return Response.json({ error: created.error }, { status: created.status });

  // a recipe typed in by hand was invisible to browse; classified on save, only when the fields
  // are empty, and never at the cost of the save itself
  await classifyIfUnclassified(supabase, created.id);

  return Response.json({ id: created.id });
}

const ROLES = new Set([
  "protein", "carbohydrate", "sauce", "vegetable", "garnish", "marinade", "sweet",
]);

/**
 * What the client is allowed to say about a blend: which recipe, and which of its lines.
 *
 * Never the ingredient text. A client that could post content would have it stored under a
 * lineage claiming it came from a recipe that never contained it, and nothing downstream could
 * tell the difference — so every field here is a selection or a label, and the lines themselves
 * are read from the database in `createBlendFrom`.
 *
 * Validated rather than cast. `role` is checked against the same closed list the column's CHECK
 * holds, so a bad value is a sentence here instead of a constraint violation two writes later.
 */
function readBlend(
  input: unknown,
): { ok: true; value: { title: string; parts: RequestedPart[] } } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "expected a blend" };
  const raw = input as { title?: unknown; parts?: unknown };
  if (typeof raw.title !== "string") return { ok: false, error: "a blend needs a title" };
  if (!Array.isArray(raw.parts)) return { ok: false, error: "a blend needs parts" };

  const parts: RequestedPart[] = [];
  for (const entry of raw.parts) {
    if (typeof entry !== "object" || entry === null) return { ok: false, error: "a part is not an object" };
    const part = entry as Record<string, unknown>;
    if (typeof part.sourceRecipeId !== "string" || !part.sourceRecipeId) {
      return { ok: false, error: "a part must name its recipe" };
    }
    if (!Array.isArray(part.lineIndexes) || part.lineIndexes.some((n) => !Number.isInteger(n) || (n as number) < 0)) {
      return { ok: false, error: "a part must name whole, non-negative line numbers" };
    }
    const role = typeof part.role === "string" && ROLES.has(part.role) ? part.role : null;
    parts.push({
      sourceRecipeId: part.sourceRecipeId,
      componentName: typeof part.componentName === "string" ? part.componentName : "",
      role,
      taken: part.taken === "whole" ? "whole" : "component",
      lineIndexes: part.lineIndexes as number[],
      // a client asserting its own agreement would be asserting a measurement it did not take
      agreement: null,
      readings: null,
      adjusted: part.adjusted === true,
    });
  }
  return { ok: true, value: { title: raw.title, parts } };
}
