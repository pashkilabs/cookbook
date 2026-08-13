"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserClient } from "@/lib/supabase-browser";

/**
 * Sign out clears the session cookie and sends the person back to the door.
 *
 * `router.refresh()` after, so the server components re-read a session that is now absent
 * rather than rendering a cached page for somebody who has left.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="quiet"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await browserClient().auth.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
