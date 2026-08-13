"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";

/**
 * Finish a confirmation that arrived in the URL fragment.
 *
 * Supabase's default confirmation email links to GoTrue's own `/verify`, which confirms the
 * address and then redirects back with the session in the **fragment**:
 *
 *   http://host/sign-in#access_token=…&refresh_token=…&type=signup
 *
 * A fragment is never sent to a server, so no route handler or Server Component can see it.
 * Completing it has to happen in the browser. That is the whole reason this component exists.
 *
 * **Why not the tidier server-side flow?** `verifyOtp` with a `token_hash` is server-side and
 * cleaner, and it needs a custom email template — which the hosted project cannot have:
 * *"Email template modification is not available for free tier projects using the default
 * email provider."* Running one flow locally and another on hosted is exactly the asymmetry
 * that has already produced two bugs in this repo, so both use the default.
 *
 * Landing here rather than on a dedicated route is deliberate too: if `emailRedirectTo` is not
 * on the project's allow list, GoTrue falls back to `site_url` — and browsers carry a fragment
 * across a redirect, so an unconfirmed visitor ends up on the sign-in page either way. One
 * path that cannot be misconfigured beats two that can.
 */
export function ConfirmationFromFragment() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    // clear it immediately: tokens should not sit in the address bar or in history
    const clearFragment = () =>
      window.history.replaceState(null, "", window.location.pathname + window.location.search);

    const failure = fragment.get("error_description") ?? fragment.get("error");
    if (failure) {
      clearFragment();
      setState("failed");
      setDetail(failure.replace(/\+/g, " "));
      return;
    }

    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    if (!accessToken || !refreshToken) return;

    setState("working");
    clearFragment();

    void (async () => {
      const supabase = browserClient();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        setState("failed");
        setDetail(error.message);
        return;
      }

      // first confirmed sign-in: this is where the household comes into existence
      const provisioned = await fetch("/api/household", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!provisioned.ok) {
        setState("failed");
        setDetail("Your email is confirmed, but setting up your household did not finish. Signing in will complete it.");
        return;
      }

      router.replace("/recipes");
      router.refresh();
    })();
  }, [router]);

  if (state === "working") return <div className="notice">Confirming your email…</div>;
  if (state === "failed") {
    return (
      <div className="notice">
        {detail ?? "That confirmation link did not work."} Ask for another one below.
      </div>
    );
  }
  return null;
}
