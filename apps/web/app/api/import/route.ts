import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { attemptImport, attemptPasteImport, spendImportQuota } from "@/lib/import";
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
/** Phone screenshots run 1.5–3.7 MB; this is generous for one and refuses an unresized photo. */
const MAX_IMAGE_BYTES = 4_500_000;
/** A reel spans a few frames, not an album. */
const MAX_IMAGES = 6;

export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "this account has no household" }, { status: 403 });

  /*
   * Three channels on one route, in one order.
   *
   * Not three routes: each route file is a serverless function and a deployment has already been
   * refused for exceeding the host's twelve-function limit (§37).
   *
   * §49 sets the order — **link beats text beats images.** A page that publishes structured data
   * is free, byte-identical and scored 99.3%; a caption scores 80.4% for $0.0007; a reel scores
   * about a third of its caption twin and costs more. So a request carrying more than one channel
   * is served by the best one available, and the others are ignored rather than merged.
   */
  const contentType = request.headers.get("content-type") ?? "";
  let url = "";
  let text = "";
  let images: { bytes: Uint8Array; label: string }[] = [];

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "that upload could not be read" }, { status: 400 });
    }
    url = String(form.get("url") ?? "").trim();
    text = String(form.get("text") ?? "").trim();

    const parts = form.getAll("images").filter((part): part is File => part instanceof File);
    if (parts.length > MAX_IMAGES) {
      return Response.json(
        { error: `${parts.length} images is more than one recipe needs. ${MAX_IMAGES} at a time.` },
        { status: 413 },
      );
    }

    for (const part of parts) {
      /*
       * The ceiling is checked here, before an image library is anywhere near the bytes.
       *
       * A 20 MB upload should never reach sharp: decoding is where the memory goes, and a native
       * addon is the last thing that should be handed something unvalidated. The preparer has its
       * own limit and that is the second line, not the first.
       */
      if (part.size > MAX_IMAGE_BYTES) {
        return Response.json(
          {
            error: `${part.name || "that image"} is ${(part.size / 1e6).toFixed(1)} MB. The limit is ${MAX_IMAGE_BYTES / 1e6} MB — a phone screenshot resized to about 1500px wide is comfortably under it.`,
          },
          { status: 413 },
        );
      }
      images.push({ bytes: new Uint8Array(await part.arrayBuffer()), label: part.name || "image" });
    }
  } else {
    let body: { url?: unknown; text?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: "expected a JSON body" }, { status: 400 });
    }
    url = typeof body.url === "string" ? body.url.trim() : "";
    text = typeof body.text === "string" ? body.text.trim() : "";
  }
  if (!url && !text && images.length === 0) {
    return Response.json(
      { error: "paste a recipe link, the text of one, or a screenshot" },
      { status: 400 },
    );
  }

  /*
   * A link and a caption are two channels, and the link wins (decisions §49).
   *
   * Where a recipe exists as both, the caption path scores about a third of the page path and
   * costs money; a page that publishes structured data is free and byte-identical. So a request
   * carrying both is a page import, and the text is ignored rather than merged.
   */
  const { outcome, storagePath, photoDimensions, photoFailure } = url
    ? await attemptImport(url, family.id)
    : {
        // text before images, per §49: a caption reads better than a picture of one
        outcome: await attemptPasteImport(text ? { text } : { images }),
        storagePath: null,
        photoDimensions: null,
        photoFailure: null,
      };

  if (!outcome.ok) {
    const channel: Channel = url ? "url" : text ? "text" : "images";
    return Response.json(explain(outcome.failure, channel), { status: 422 });
  }

  // a pasted caption is never cached — it has no URL to key on — so it always charges
  if (!("fromCache" in outcome) || !outcome.fromCache) {
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
    // named rather than implied: "no picture" and "the image library will not load here" are
    // different facts, and only one of them is a deployment problem
    ...(photoFailure ? { photoFailure } : {}),
    // a caption has no page and no cache to key on, so it reports neither
    tier: "tier" in outcome ? outcome.tier : "llm",
    fromCache: "fromCache" in outcome ? outcome.fromCache : false,
  });
}

/** Say what happened in words, and never claim a capability that is not built. */
type Channel = "url" | "text" | "images";

/**
 * Say what happened in words, in the words of the channel it happened to.
 *
 * regression: a photograph came back with "This page publishes no machine-readable recipe. Tiers
 * 0 and 1 — structured data and microdata — both found nothing." There is no page. The failure
 * kinds are shared across channels and the prose was written for one of them, which is the same
 * channel-blindness the refusal reasons had: `not-a-recipe-page` is meaningless about a photo,
 * and so is advice about microdata.
 *
 * Every message below either states the channel it is about or is true of all three.
 */
function explain(failure: { kind: string; [key: string]: unknown }, channel: Channel = "url") {
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
        channel === "images"
          ? "No recipe could be read from that photograph. A clearer or closer shot of the " +
            "ingredients often works — or type it in."
          : channel === "text"
            ? "No recipe could be read from that text. If it only promises the recipe in a DM, " +
              "there is nothing to read yet."
            : "This page publishes no machine-readable recipe. Tiers 0 and 1 — structured data " +
              "and microdata — both found nothing, and reading the page text itself is not built " +
              "yet. You can type the recipe in instead.",
      reason: failure.kind,
    };
  }

  if (failure.kind === "recipe-incomplete") {
    const missing = Array.isArray(failure.missing) ? failure.missing.join(", ") : "required fields";
    return {
      error:
        channel === "url"
          ? `The page had recipe data but not enough of it — missing ${missing}. Reading the page text itself is not built yet.`
          : `Some of the recipe came through but not enough of it — missing ${missing}.`,
      reason: failure.kind,
    };
  }

  /*
   * Nothing was read, so nothing can be said about what was there. Named rather than folded into
   * "that did not work": one of these is a deployment problem and the other is the picture.
   */
  if (failure.kind === "no-usable-images") {
    const rejected = Array.isArray(failure.rejected) ? failure.rejected : [];
    const detail = rejected[0] && typeof rejected[0] === "object"
      ? String((rejected[0] as { detail?: unknown }).detail ?? "")
      : "";
    return {
      error: `That image could not be used${detail ? ` — ${detail}` : ""}. A photo straight from a phone is usually fine; a very large one may need resizing.`,
      reason: failure.kind,
    };
  }

  if (failure.kind === "vision-not-configured") {
    return {
      error: "Reading photographs is not switched on for this deployment.",
      reason: failure.kind,
    };
  }

  if (failure.kind === "private-address" || failure.kind === "invalid-url") {
    return { error: "That does not look like a recipe link.", reason: failure.kind };
  }
  void channel;

  if (failure.kind === "fetch-failed" || failure.kind === "not-html") {
    return {
      error: `That page could not be read (${String(failure.detail ?? failure.kind)}). Some sites refuse automated requests.`,
      reason: failure.kind,
    };
  }

  return { error: "That import did not work.", reason: failure.kind };
}
