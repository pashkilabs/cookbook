/**
 * What we would send, for a person to look at before anything is sent (§74, §75).
 *
 * **This is the review screen's data, and the review screen is the mechanism rather than the
 * caution.** §75 measured the single-match bucket containing parmesan returned for red pepper
 * flakes — with the two correct products in the same result set, discarded for lacking a word. So
 * there is no confidence tier: the useful split is *something to show / nothing to show*, and
 * nothing may be chosen on a household's behalf.
 *
 * Reads only. No cart, no user token, no money — `product.compact` on an app token, which their
 * API will not let near a cart even by mistake.
 */
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { buildShoppingWeek } from "@/lib/shopping";
import { appToken, findProducts, krogerConfig, type KrogerProduct } from "@/lib/kroger";
import { serviceClient } from "@/lib/service-client";
import { rows } from "@/lib/rows";
import { startOfWeek, todayIso, weekDays } from "@/lib/week";

export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const config = krogerConfig();
  if (!config) return Response.json({ error: "Kroger is not configured" }, { status: 503 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "no household" }, { status: 403 });
  if (!family.krogerLocationId) {
    return Response.json(
      { error: "pick a store on /household first — product search and pricing both need one" },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { weekStart?: unknown };
  const weekStart =
    typeof body.weekStart === "string" ? body.weekStart : startOfWeek(todayIso(family.timezone));

  const { week, error: weekError } = await buildShoppingWeek(
    supabase,
    family.id,
    weekStart,
    weekDays(weekStart),
    family.measurementSystem,
  );
  if (weekError || !week) {
    // could-not-read and nothing-planned are different answers and only one is the household's
    return Response.json({ error: weekError ?? "nothing planned for that week" }, { status: weekError ? 502 : 404 });
  }

  const token = await appToken(config);
  if (!token) return Response.json({ error: "Kroger would not issue a token" }, { status: 502 });

  /*
   * Already sent this week? Said plainly, with the line keys, so the screen can offer the **delta**
   * rather than the whole list. The unchanged lines are already in their cart and re-sending them
   * doubles them — and the cart cannot be read to find out (§74).
   */
  const previous = rows(
    await serviceClient()
      .from("cart_exports")
      .select("line_keys, sent_at, status, item_count")
      .eq("family_id", family.id)
      .eq("week_start", weekStart)
      .in("status", ["intent", "sent"])
      .is("deleted_at", null),
    "previous exports of this week",
  ) as Array<{ line_keys: string[]; sent_at: string | null; status: string; item_count: number }>;
  const alreadySent = new Set(previous.flatMap((row) => row.line_keys));

  /*
   * Excluded exactly as §73's builder excludes: ticked, fully covered by the pantry, or in the
   * pantry in an unknown amount. The ticks are the join `consolidate` cannot see, and an export
   * built without them re-buys the trolley.
   */
  const candidates = week.lines.filter((line) => {
    if (week.ticked.has(line.key)) return false;
    if (line.needed <= 0) return false;
    if (line.inPantry && !line.pantryDeducted) return false;
    return true;
  });

  const proposals: Array<{
    key: string; label: string; needed: string; packages: string | null;
    alreadyInCart: boolean; branch: string; products: KrogerProduct[];
  }> = [];
  const unavailable: Array<{ key: string; label: string; reason: string }> = [];

  for (const line of candidates) {
    const found = await findProducts(config, token, line.label, family.krogerLocationId);
    if (found === null) {
      // the provider, not the catalogue: said apart so it cannot read as "they do not stock it"
      unavailable.push({ key: line.key, label: line.label, reason: "Kroger did not answer" });
      continue;
    }
    if (found.products.length === 0) {
      unavailable.push({ key: line.key, label: line.label, reason: "nothing matched — add it yourself" });
      continue;
    }
    proposals.push({
      key: line.key,
      label: line.label,
      needed: line.neededDisplay,
      packages: line.packagesDisplay,
      alreadyInCart: alreadySent.has(line.key),
      branch: found.branch,
      products: found.products,
    });
  }

  return Response.json({
    ok: true,
    weekStart,
    environment: config.environment,
    store: family.krogerLocationId,
    proposals,
    unavailable,
    previouslySent: previous.length > 0
      ? { at: previous[0]!.sent_at, items: previous.reduce((sum, row) => sum + row.item_count, 0) }
      : null,
  });
}
