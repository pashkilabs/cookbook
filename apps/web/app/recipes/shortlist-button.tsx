"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Make this week" — the one act that turns browsing into scheduling.
 *
 * The week is passed in rather than computed here: the server already worked out which Monday
 * this is, and a client clock in another zone would occasionally shortlist the wrong week.
 */
export function ShortlistButton(props: {
  recipeId: string;
  weekStart: string;
  shortlisted: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [shortlisted, setShortlisted] = useState(props.shortlisted);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle(event: React.MouseEvent) {
    // the button sits inside a card that is itself a link
    event.preventDefault();
    event.stopPropagation();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/shortlist", {
      method: shortlisted ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId: props.recipeId, weekStart: props.weekStart }),
    });
    if (!response.ok) {
      const failed = (await response.json().catch(() => ({}))) as { error?: string };
      setError(failed.error ?? `that did not work (${response.status})`);
      setBusy(false);
      return;
    }
    setShortlisted(!shortlisted);
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className={shortlisted ? props.className : `quiet ${props.className ?? ""}`}
        disabled={busy}
        aria-pressed={shortlisted}
        onClick={toggle}
      >
        {busy ? "…" : shortlisted ? "On this week's list" : "Make this week"}
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
