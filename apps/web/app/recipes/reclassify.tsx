"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Ask for the classification to be worked out again.
 *
 * **A button, never automatic on save.** Somebody may have corrected a field by hand, and a model
 * overwriting that is worse than the field being stale: a person who fixes "beef" on a mushroom
 * pasta and watches it come back beef will stop fixing anything.
 *
 * It says what it will do, because it discards what is there — this is the one place a model is
 * allowed to overwrite a person's answer, and only because they asked.
 */
export function ReclassifyButton({ recipeId }: { recipeId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const response = await fetch(`/api/recipes/${recipeId}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { error?: string; classification?: Record<string, string | null> | null }
        | null;
      if (!response.ok) {
        setError(body?.error ?? `that did not work (HTTP ${response.status})`);
        return;
      }
      /*
       * Say what happened, always.
       *
       * regression: this refreshed and said nothing, and the page it refreshed did not display
       * these fields — so a successful re-classification and a silent failure looked identical,
       * and both looked like a dead button. A control with no feedback cannot be trusted or
       * debugged, and "nothing visibly changed" is a real outcome that has to be reportable.
       */
      const values = Object.values(body?.classification ?? {}).filter(Boolean);
      setOutcome(values.length > 0 ? `Now: ${values.join(" · ")}` : "No change — it could not tell.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="button quiet" disabled={busy} onClick={run}>
        {busy ? "Working it out…" : "Work these out again"}
      </button>
      <span className="meta"> Replaces the four fields above with a fresh reading.</span>
      {outcome && <p className="meta">{outcome}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
