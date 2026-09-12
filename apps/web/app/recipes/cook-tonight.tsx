"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Put this on today, in one tap.
 *
 * The only act connecting a recipe to a day was "Make this week" — a phrase about the week, not
 * the evening — which put it on a shortlist. Getting it onto *today* then meant leaving the
 * recipe, opening the planner, finding it under "Waiting for a day", and tapping the day. Four
 * screens to say "we are having this in an hour", from the screen where somebody had already
 * decided.
 *
 * `date` is today **in the household's timezone**, computed on the server and passed in: a
 * browser clock would disagree with the planner for anybody whose device zone differs from the
 * household's, which is exactly the split the timezone column exists to close.
 *
 * A 409 means it is already on today. Not an error — the household is told, which is the same
 * shape the planner uses (§41), because refusing and silently merging are both worse than saying
 * so.
 */
export function CookTonight({ recipeId, today }: { recipeId: string; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "planned" | "already">("idle");
  const [error, setError] = useState<string | null>(null);

  const plan = async () => {
    setBusy(true);
    setError(null);
    // `finally`: an offline fetch rejects, and the button is gated on this flag
    try {
      const response = await fetch("/api/plan-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipeId, date: today }),
      });
      if (response.status === 409) {
        setState("already");
        return;
      }
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        setError(failed.error ?? `that did not work (${response.status})`);
        return;
      }
      setState("planned");
      router.refresh();
    } catch {
      setError("No signal — that was not saved.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "planned") {
    return <span className="meta">On tonight — mark it cooked from the planner.</span>;
  }
  if (state === "already") {
    return <span className="meta">Already on tonight.</span>;
  }

  return (
    <>
      <button type="button" className="button" disabled={busy} onClick={plan}>
        {busy ? "…" : "Cook it tonight"}
      </button>
      {error && <span className="meta">{error}</span>}
    </>
  );
}
