"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Make this week" — the one act that turns browsing into scheduling.
 *
 * The week is passed in rather than computed here: the server already worked out which Monday
 * this is, and a client clock in another zone would occasionally shortlist the wrong week.
 *
 * **Two weeks, not one.** Both call sites hard-coded today's Monday, so there was no way anywhere
 * in the product to shortlist for a later week — and the planner's waiting list is week-scoped, so
 * navigating forward showed an empty week with the recipe stranded in this one. Both halves worked
 * and the join did not, which is the failure this fixes.
 *
 * Next week only, and no date picker. Two weeks covers what a household plans, and a picker
 * invites the question of how far ahead a shortlist should reach — which nobody has asked.
 */
export function ShortlistButton(props: {
  recipeId: string;
  weekStart: string;
  /** the Monday after `weekStart`, worked out on the server for the same clock reason */
  nextWeekStart: string;
  shortlisted: boolean;
  shortlistedNext?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [shortlisted, setShortlisted] = useState(props.shortlisted);
  const [nextWeek, setNextWeek] = useState(props.shortlistedNext ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle(event: React.MouseEvent, week: "this" | "next") {
    // the button sits inside a card that is itself a link
    event.preventDefault();
    event.stopPropagation();
    setBusy(true);
    setError(null);

    const on = week === "this" ? shortlisted : nextWeek;
    const response = await fetch("/api/shortlist", {
      method: on ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipeId: props.recipeId,
        weekStart: week === "this" ? props.weekStart : props.nextWeekStart,
      }),
    });
    if (!response.ok) {
      const failed = (await response.json().catch(() => ({}))) as { error?: string };
      setError(failed.error ?? `that did not work (${response.status})`);
      setBusy(false);
      return;
    }
    if (week === "this") setShortlisted(!shortlisted);
    else setNextWeek(!nextWeek);
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
        onClick={(event) => toggle(event, "this")}
      >
        {busy ? "…" : shortlisted ? "On this week's list" : "Make this week"}
      </button>
      <button
        type="button"
        className={nextWeek ? props.className : `quiet ${props.className ?? ""}`}
        disabled={busy}
        aria-pressed={nextWeek}
        onClick={(event) => toggle(event, "next")}
      >
        {busy ? "…" : nextWeek ? "On next week's list" : "Next week"}
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
