import { anonAuth } from "@/lib/auth-anon";
import { createRateLimiter } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";

/**
 * Resend a confirmation email.
 *
 * Same shape as sign-up and for the same reason: one response whatever the address is. A
 * resend endpoint that answers "no such account" is the same oracle by a different door.
 *
 * Stricter than sign-up — one per ten minutes per address — because resend is the button
 * people press repeatedly when an email is slow, and every press spends from Supabase's
 * 2-per-hour project budget. A refusal still answers 202: a 429 would confirm that the
 * address exists and is being retried.
 */
const perAddress = createRateLimiter({ limit: 1, windowSeconds: 600 });

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) return Response.json({ error: "email is required" }, { status: 400 });

  const accepted = Response.json(
    {
      status: "confirmation-sent",
      message: "If that address needs confirming, a new link is on its way.",
    },
    { status: 202 },
  );

  if (!perAddress.check(email).allowed) return accepted;

  const { error } = await anonAuth().auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${siteUrl()}/sign-in` },
  });
  if (error) {
    console.warn(`[pashki] resend did not send for a submitted address: ${error.message}`);
  }

  return accepted;
}
