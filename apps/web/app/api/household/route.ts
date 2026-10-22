import { provisionForConfirmedAccount } from "@/lib/provisioning";
import { platformClient } from "@/lib/platform";
import { userClient } from "@/lib/supabase-server";

/**
 * Provision the household for whoever holds this bearer token.
 *
 * Called by the sign-in form after a successful password sign-in, and mirrored by
 * `/auth/confirm`, which does the same thing at the moment of confirmation. Both are safe to
 * run repeatedly: `provisionHousehold` is idempotent, so the second and every subsequent call
 * is a read.
 *
 * It used to *create the account* — with `email_confirm: true`, which meant the app vouched
 * for addresses it had never contacted. That is gone. This route now creates nothing unless
 * the auth server confirms both that the token is live and that the address was proven.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return Response.json({ error: "a bearer token is required" }, { status: 401 });
  }

  const outcome = await provisionForConfirmedAccount(token);

  if (outcome.status === "unauthenticated") {
    return Response.json({ error: "that session is not valid" }, { status: 401 });
  }
  if (outcome.status === "unconfirmed") {
    // 403 rather than 401: the token is real, the address is not proven. Distinguishable on
    // purpose — the caller already holds a session for this address, so there is nothing left
    // to enumerate.
    return Response.json(
      { error: "confirm your email address before creating a household" },
      { status: 403 },
    );
  }

  /*
   * Two ways to end up with a household: being given a new one, or joining one you were invited
   * to. `joined` is reported distinctly so the caller can say "you're in the Smiths' kitchen"
   * rather than implying a household was created for them.
   */
  if (outcome.status === "joined") {
    return Response.json({
      familyId: outcome.familyId,
      joined: true,
      created: false,
      familyName: outcome.familyName,
      canWrite: outcome.canWrite,
    });
  }

  return Response.json({
    familyId: outcome.familyId,
    joined: false,
    created: outcome.created,
    canWrite: outcome.canWrite,
  });
}

/**
 * Change a household setting. Today that is the measurement system and nothing else.
 *
 * On this route rather than a new one: each route file is a serverless function and a deployment
 * has already been refused for exceeding the host's twelve-function limit (§37). A household
 * setting belongs beside household provisioning anyway.
 *
 * `families` is a platform table, so the write goes through the seam — app code may not touch one
 * (`check-platform-tables.mjs` fails the build on a direct query).
 */
export async function PATCH(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  let body: {
    measurementSystem?: unknown; timezone?: unknown; avoidedAllergens?: unknown;
    /** one allergen on or off — what a person's toggle sends, see the branch below */
    addAllergen?: unknown; removeAllergen?: unknown;
    krogerLocationId?: unknown;
      /** a layout name, or null to dismiss the question without choosing */
    recipeLayout?: unknown;
};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  /*
   * What day it is where the household cooks.
   *
   * Handled first and returning immediately, so it does not fall through to the measurement
   * validation — the mistake that made a move-only plan-entry PATCH answer 400 about servings.
   */
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !body.timezone) {
      return Response.json({ error: "timezone must be an IANA zone name" }, { status: 400 });
    }
    try {
      const family = await platformClient(auth.user.id).setTimezone(body.timezone);
      return Response.json({ timezone: family.timezone });
    } catch (thrown) {
      return Response.json(
        { error: thrown instanceof Error ? thrown.message : "that timezone was refused" },
        { status: 400 },
      );
    }
  }

  /*
   * Checked before `measurementSystem`, and only when present — the same shape as `timezone`
   * above, which exists because a move-only plan-entry PATCH once answered 400 about servings.
   *
   * Validated for *type* here and for *value* by the CHECK on the column: `packages/core` owns
   * the matching vocabulary and the constraint owns storage, so a third list in this route would
   * be a third site to drift (§71).
   */
  /*
   * One allergen on or off, which is what a toggle actually expresses.
   *
   * Checked **before** `avoidedAllergens` so the delta is the path a screen takes. The whole-array
   * branch below still exists for a deliberate absolute set (a script, a test, an import), but a
   * control must not use it: it would be sending a list derived from a value it cannot verify, and
   * that is precisely how a member's empty view came to be written over a real exclusion. The
   * server applies the change to what is stored, so a wrong seed renders wrongly and erases
   * nothing.
   */
  if (body.addAllergen !== undefined || body.removeAllergen !== undefined) {
    const adding = body.addAllergen !== undefined;
    const allergen = adding ? body.addAllergen : body.removeAllergen;
    if (body.addAllergen !== undefined && body.removeAllergen !== undefined) {
      return Response.json({ error: "send addAllergen or removeAllergen, not both" }, { status: 400 });
    }
    if (typeof allergen !== "string" || !allergen) {
      return Response.json({ error: "addAllergen/removeAllergen must be an allergen name" }, { status: 400 });
    }
    try {
      const family = await platformClient(auth.user.id).changeAvoidedAllergen(
        allergen,
        adding ? "add" : "remove",
      );
      return Response.json({ avoidedAllergens: family.avoidedAllergens });
    } catch (thrown) {
      return Response.json(
        { error: thrown instanceof Error ? thrown.message : "that allergen was refused" },
        { status: 400 },
      );
    }
  }

  if (body.avoidedAllergens !== undefined) {
    const list = body.avoidedAllergens;
    if (!Array.isArray(list) || list.some((value) => typeof value !== "string")) {
      return Response.json({ error: "avoidedAllergens must be an array of allergen names" }, { status: 400 });
    }
    try {
      const family = await platformClient(auth.user.id).setAvoidedAllergens(list as string[]);
      return Response.json({ avoidedAllergens: family.avoidedAllergens });
    } catch (thrown) {
      return Response.json(
        { error: thrown instanceof Error ? thrown.message : "those were refused" },
        { status: 400 },
      );
    }
  }

  /*
   * How this household decides what to cook (§85).
   *
   * `recipeLayout: null` is a **dismissal** — the question was put and declined, which stamps
   * `recipe_layout_asked_at` and leaves the layout alone. That is why `null` is meaningful here
   * rather than a missing field, and why `undefined` (the key absent) means "this PATCH is not
   * about the layout" as every other branch in this route does.
   *
   * Validated for *type* here and for *value* by the CHECK on the column. A third copy of the
   * five names in this route would be a third site to drift from, which is the reason the
   * allergen branch above does the same.
   */
  if (body.recipeLayout !== undefined) {
    const layout = body.recipeLayout;
    if (layout !== null && typeof layout !== "string") {
      return Response.json(
        { error: "recipeLayout must be a layout name, or null to dismiss the question" },
        { status: 400 },
      );
    }
    try {
      const family = await platformClient(auth.user.id).setRecipeLayout(layout);
      return Response.json({
        recipeLayout: family.recipeLayout,
        recipeLayoutAskedAt: family.recipeLayoutAskedAt,
      });
    } catch (thrown) {
      return Response.json(
        { error: thrown instanceof Error ? thrown.message : "that layout was refused" },
        { status: 400 },
      );
    }
  }

  /*
   * The store. Validated for shape here and for *value* by the CHECK on the column — a
   * free-text column would happily hold a URL, and §74's probe needs a store id that is a store
   * id. Null clears it.
   */
  if (body.krogerLocationId !== undefined) {
    const id = body.krogerLocationId;
    if (id !== null && (typeof id !== "string" || !/^\d{6,10}$/.test(id))) {
      return Response.json({ error: "krogerLocationId must be a Kroger store id, or null" }, { status: 400 });
    }
    try {
      const family = await platformClient(auth.user.id).setKrogerLocation(id as string | null);
      return Response.json({ krogerLocationId: family.krogerLocationId });
    } catch (thrown) {
      return Response.json(
        { error: thrown instanceof Error ? thrown.message : "that store was refused" },
        { status: 400 },
      );
    }
  }

  const system = body.measurementSystem;
  if (system !== "us" && system !== "metric") {
    return Response.json({ error: "measurementSystem must be us or metric" }, { status: 400 });
  }

  try {
    const family = await platformClient(auth.user.id).setMeasurementSystem(system);
    return Response.json({ measurementSystem: family.measurementSystem });
  } catch (error) {
    const message = error instanceof Error ? error.message : "that did not work";
    return Response.json({ error: message }, { status: 400 });
  }
}
