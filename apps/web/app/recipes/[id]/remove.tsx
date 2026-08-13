"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Remove a recipe, behind an inline confirmation.
 *
 * **Inline, not `confirm()`.** A native dialog is poor on mobile and an embedding context can
 * suppress it outright — which would turn "are you sure" into "deleted" (CLAUDE.md).
 *
 * It is a tombstone, not a delete: the row stays with `deleted_at` set, because a hard-deleted
 * row is indistinguishable to a peer from one that never synced.
 */
export function RemoveRecipe({ recipeId, title }: { recipeId: string; title: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <button type="button" className="quiet" onClick={() => setAsking(true)}>
        Remove
      </button>
    );
  }

  return (
    <span className="confirm">
      <span className="meta">Remove “{title}”?</span>
      <button
        type="button"
        className="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const response = await fetch(`/api/recipes/${recipeId}`, { method: "DELETE" });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            setError(body.error ?? `could not remove it (${response.status})`);
            setBusy(false);
            return;
          }
          router.push("/recipes");
          router.refresh();
        }}
      >
        {busy ? "Removing…" : "Yes, remove"}
      </button>
      <button type="button" className="quiet" disabled={busy} onClick={() => setAsking(false)}>
        Keep it
      </button>
      {error && <span className="error">{error}</span>}
    </span>
  );
}
