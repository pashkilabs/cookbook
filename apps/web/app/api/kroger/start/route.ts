/**
 * Begin a Kroger cart export (§74).
 *
 * **The intent row is written before the person leaves for Kroger.** Not after, and not on the way
 * back: the cart cannot be read, so a request whose outcome is unknown is indistinguishable from
 * one that landed, and with money the asymmetry is plain — under-sending costs somebody adding an
 * item by hand, double-sending costs a duplicate order. A row that exists before anything is sent
 * is the only way the unknown case resolves safely.
 *
 * The approved UPCs come from the caller, because **nothing here may pick a product**. §75 measured
 * the single-match bucket containing parmesan returned for red pepper flakes with the correct
 * products in the same result set — there is no confidence tier, so the review screen is the
 * mechanism and this route refuses a body that has not been through it.
 */
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { serviceClient } from "@/lib/service-client";
import { maybeRow } from "@/lib/rows";
import { authorizeUrl, krogerConfig } from "@/lib/kroger";
import { fingerprint } from "@pashki/core";
import { startOfWeek, todayIso } from "@/lib/week";

export async function POST(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const config = krogerConfig();
  if (!config) return Response.json({ error: "Kroger is not configured" }, { status: 503 });

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) return Response.json({ error: "no household" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    weekStart?: unknown;
    items?: unknown;
    lineKeys?: unknown;
  };
  const weekStart = typeof body.weekStart === "string" ? body.weekStart : startOfWeek(todayIso(family.timezone));
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    return Response.json({ error: "nothing to send" }, { status: 400 });
  }
  const clean: Array<{ upc: string; quantity: number }> = [];
  for (const raw of items) {
    const upc = (raw as { upc?: unknown }).upc;
    const quantity = (raw as { quantity?: unknown }).quantity;
    if (typeof upc !== "string" || !/^\d{12,14}$/.test(upc)) {
      return Response.json({ error: `not a UPC: ${String(upc)}` }, { status: 400 });
    }
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return Response.json({ error: "quantity must be 1 to 50" }, { status: 400 });
    }
    clean.push({ upc, quantity });
  }
  const lineKeys = Array.isArray(body.lineKeys)
    ? body.lineKeys.filter((key): key is string => typeof key === "string")
    : [];

  /*
   * Already sent this exact list? Refuse, and name the date.
   *
   * The caller is expected to have offered the delta instead — but a refusal here is the backstop,
   * because the screen can be reloaded, the back button exists, and the cart cannot be consulted.
   */
  const service = serviceClient();
  const bodyFingerprint = fingerprint([
    config.environment,
    weekStart,
    JSON.stringify(clean),
  ]);
  const already = maybeRow(
    await service
      .from("cart_exports")
      .select("id, sent_at, item_count, status")
      .eq("family_id", family.id)
      .eq("week_start", weekStart)
      .eq("body_fingerprint", bodyFingerprint)
      .is("deleted_at", null)
      .maybeSingle(),
    "a previous export of this list",
  ) as { id: string; sent_at: string | null; item_count: number; status: string } | null;
  if (already) {
    return Response.json(
      {
        error: "this exact list has already gone to your cart",
        sentAt: already.sent_at,
        itemCount: already.item_count,
        // their cart cannot be read, so we cannot check and must not imply that we did
        detail: "Kroger's cart cannot be read back, so sending again would add all of it a second time.",
      },
      { status: 409 },
    );
  }

  const { data: intent, error } = await service
    .from("cart_exports")
    .insert({
      family_id: family.id,
      week_start: weekStart,
      status: "intent",
      line_keys: lineKeys,
      body_fingerprint: bodyFingerprint,
      environment: config.environment,
      item_count: clean.length,
      /*
       * Held on the row, not in the OAuth `state`: Kroger echoes state back verbatim and a person
       * can edit it, so a basket could be rewritten on the way through. `state` carries only this
       * row's id, and the callback checks the row belongs to the household whose session arrives
       * with it.
       */
      items: clean,
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/kroger/callback`;

  return Response.json({
    ok: true,
    exportId: intent.id,
    environment: config.environment,
    // built from configuration, never from the request's Host header — a Host is attacker-controlled
    authorizeUrl: authorizeUrl(config, redirectUri, intent.id),
    items: clean,
  });
}
