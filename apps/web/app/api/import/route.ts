import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { attemptImport, spendImportQuota } from "@/lib/import";
import { draftFrom } from "@/lib/draft";

/**
 * Read a recipe off a page. Save nothing.
 *
 * **Nothing saves without the person seeing it** (CLAUDE.md), so this returns a draft and creates
 * no rows. The review screen is what makes cheap extraction good enough, and adding a silent-save
 * path would remove the only thing standing between a bad parse and a household's recipe book.
 *
 * Quota is spent here rather than at save: fetching a page and decoding its photo is the cost, and
 * a person who abandons a review has still spent it. It is not spent on a cache hit, because a
 * recipe already extracted for somebody else costs nothing to hand over.
 */
export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  let body: { url?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return Response.json({ error: "paste a recipe link" }, { status: 400 });

  const { outcome, storagePath, photoDimensions } = await attemptImport(url, family.id);

  if (!outcome.ok) {
    return Response.json(explain(outcome.failure), { status: 422 });
  }

  if (!outcome.fromCache) {
    const spent = await spendImportQuota(auth.user.id);
    if (spent.status !== "allowed") {
      return Response.json(
        {
          error:
            spent.status === "no-entitlement"
              ? "This household has no import allowance. A subscription is what grants one."
              : "You have used this month's imports. The allowance resets with the billing period.",
          reason: spent.status,
        },
        { status: 429 },
      );
    }
  }

  return Response.json({
    // the same shape the batch queue hands back — one draft builder, so the review screen cannot
    // be shown two different renderings of the same parse
    draft: draftFrom(outcome.recipe),
    photo: storagePath ? { storagePath, ...photoDimensions } : null,
    tier: outcome.tier,
    fromCache: outcome.fromCache,
  });
}

/** Say what happened in words, and never claim a capability that is not built. */
function explain(failure: { kind: string; [key: string]: unknown }) {
  if (failure.kind === "blocked-platform") {
    const platform = String(failure.platform ?? "That site");
    const route =
      failure.useInstead === "video"
        ? "Share the video file into Pashki instead — that path is built in a later phase."
        : "Take a screenshot of the recipe and import that instead — that path is built in a later phase.";
    return {
      error: `${platform} links never resolve to a page containing the recipe. ${route}`,
      reason: failure.kind,
      // rejected before a request, rather than after four doomed attempts and a timeout
      useInstead: failure.useInstead,
    };
  }

  if (failure.kind === "no-recipe-found") {
    return {
      error:
        "This page publishes no machine-readable recipe. Tiers 0 and 1 — structured data and " +
        "microdata — both found nothing, and reading the page text itself is not built yet. " +
        "You can type the recipe in instead.",
      reason: failure.kind,
    };
  }

  if (failure.kind === "recipe-incomplete") {
    return {
      error: `The page had recipe data but not enough of it — missing ${
        Array.isArray(failure.missing) ? failure.missing.join(", ") : "required fields"
      }. Reading the page text itself is not built yet.`,
      reason: failure.kind,
    };
  }

  if (failure.kind === "private-address" || failure.kind === "invalid-url") {
    return { error: "That does not look like a recipe link.", reason: failure.kind };
  }

  if (failure.kind === "fetch-failed" || failure.kind === "not-html") {
    return {
      error: `That page could not be read (${String(failure.detail ?? failure.kind)}). Some sites refuse automated requests.`,
      reason: failure.kind,
    };
  }

  return { error: "That import did not work.", reason: failure.kind };
}
