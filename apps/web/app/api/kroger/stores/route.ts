/**
 * Kroger stores near a postcode, so a household can pick one (§74).
 *
 * Reads only, app token, `product.compact`. A store is required before any product search and
 * before any price, which is why it comes first.
 */
import { userClient } from "@/lib/supabase-server";
import { appToken, krogerConfig } from "@/lib/kroger";

export async function GET(request: Request) {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "sign in first" }, { status: 401 });

  const config = krogerConfig();
  if (!config) return Response.json({ error: "Kroger is not configured" }, { status: 503 });

  const near = new URL(request.url).searchParams.get("near") ?? "";
  if (!/^\d{5}$/.test(near)) {
    return Response.json({ error: "a five-digit postcode is needed" }, { status: 400 });
  }

  const token = await appToken(config);
  if (!token) return Response.json({ error: "Kroger would not issue a token" }, { status: 502 });

  const response = await fetch(
    `${config.host}/v1/locations?filter.zipCode.near=${near}&filter.limit=8`,
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!response.ok) {
    return Response.json({ error: `Kroger answered ${response.status}` }, { status: 502 });
  }
  const body = (await response.json()) as { data?: any[] };
  return Response.json({
    ok: true,
    environment: config.environment,
    stores: (body.data ?? []).map((store) => ({
      locationId: String(store.locationId ?? ""),
      name: String(store.name ?? ""),
      address: [store.address?.addressLine1, store.address?.city, store.address?.state]
        .filter(Boolean)
        .join(", "),
    })).filter((store) => store.locationId),
  });
}
