/**
 * Kroger sends the person back here with a code; this is where the cart write happens (§74).
 *
 * ---------------------------------------------------------------------------
 * The write has no undo and no read-back
 * ---------------------------------------------------------------------------
 *
 * `PUT /v1/cart/add` is add-only — probed, not assumed: `POST` to it 404s and `/v1/cart` is not a
 * route. So nothing here can check what landed, nothing can correct it, and a second send doubles
 * the order invisibly.
 *
 * Which decides every choice below. The row was written as `intent` **before** the person left for
 * Kroger, so it already exists when this runs; this route only ever moves it forward. An outcome
 * that cannot be established stays `intent`, and `intent` is treated as sent — because
 * under-sending costs somebody adding an item by hand and double-sending costs a duplicate order.
 *
 * The token is used within seconds of arriving and never written down (§74).
 */
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { serviceClient } from "@/lib/service-client";
import { maybeRow } from "@/lib/rows";
import { addToCart, krogerConfig, userToken } from "@/lib/kroger";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const refused = url.searchParams.get("error");

  const config = krogerConfig();
  if (!config) redirect("/shopping?cart=unconfigured");

  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) redirect("/recipes");

  const service = serviceClient();

  /*
   * `state` is the intent row's id and nothing else — Kroger echoes it back verbatim, so anything
   * of value in it would be editable by the person in the middle. The row is then checked against
   * **this session's household**, which is what makes a borrowed state useless.
   */
  const intent = state
    ? (maybeRow(
        await service
          .from("cart_exports")
          .select("id, family_id, status, items, item_count, environment")
          .eq("id", state)
          .eq("family_id", family.id)
          .is("deleted_at", null)
          .maybeSingle(),
        "the export this callback belongs to",
      ) as {
        id: string; family_id: string; status: string;
        items: Array<{ upc: string; quantity: number }>; item_count: number; environment: string;
      } | null)
    : null;

  if (!intent) redirect("/shopping?cart=unknown");

  // the person declined at Kroger's screen, which is an answer and not a failure
  if (refused || !code) {
    await service.from("cart_exports").update({ status: "refused" }).eq("id", intent.id);
    redirect("/shopping?cart=declined");
  }

  /*
   * Only ever once. A reloaded callback must not send a second time, and the status is the only
   * record that exists — the cart itself cannot be consulted.
   */
  if (intent.status !== "intent") {
    redirect(`/shopping?cart=already&items=${intent.item_count}`);
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/kroger/callback`;
  const token = await userToken(config, code, redirectUri);
  if (!token) {
    /*
     * No token means nothing was sent — this is the one failure that is genuinely safe to retry,
     * because the write never happened. Marked `refused` rather than left as `intent`, so the
     * household is not told a list went out that did not.
     */
    await service.from("cart_exports").update({ status: "refused", response_status: 401 }).eq("id", intent.id);
    redirect("/shopping?cart=auth-failed");
  }

  const result = await addToCart(config, token, intent.items);

  /*
   * Recorded whatever happened, including the body. "No answer" and "an answer we did not like"
   * are different things and only one of them might be worth retrying — and since the cart cannot
   * be read, their own words are the only evidence that will ever exist about this send.
   */
  await service
    .from("cart_exports")
    .update({
      status: result.ok ? "sent" : "intent",
      response_status: result.status,
      sent_at: new Date().toISOString(),
    })
    .eq("id", intent.id);

  if (!result.ok) {
    console.warn(`[pashki] kroger cart ${result.status}: ${result.body}`);
    // left as `intent`, so a retry refuses: a failed-looking write may still have landed
    redirect(`/shopping?cart=unclear&status=${result.status}`);
  }

  redirect(`/shopping?cart=sent&items=${intent.item_count}&env=${intent.environment}`);
}
