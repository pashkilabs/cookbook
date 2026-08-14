"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Accepting, for somebody who is already signed in.
 *
 * The other route in — signing up because you were invited — is handled by provisioning, which
 * joins rather than creating when a confirmed address has an invitation waiting. This is the case
 * where an account already exists, and it is the one that needs a button.
 */
export function AcceptInvitation({
  token,
  email,
  signedInAs,
}: {
  token: string;
  email: string;
  signedInAs: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatched = signedInAs.toLowerCase() !== email.toLowerCase();

  return (
    <>
      {mismatched && (
        <div className="notice">
          This invitation was sent to <strong>{email}</strong>, and you are signed in as{" "}
          <strong>{signedInAs}</strong>. Sign in with the invited address to accept it.
        </div>
      )}

      <div className="tabs">
        <button
          type="button"
          disabled={busy || mismatched}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const response = await fetch("/api/invitations/accept", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ token }),
            });
            const body = (await response.json().catch(() => ({}))) as {
              familyId?: string;
              error?: string;
            };
            if (!response.ok || !body.familyId) {
              setError(body.error ?? `that did not work (${response.status})`);
              setBusy(false);
              return;
            }
            router.push("/recipes");
            router.refresh();
          }}
        >
          {busy ? "Joining…" : "Accept and join"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}
