"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DayCircle } from "@/components/harvest";

/**
 * Put this recipe on a day, from the recipe (§4.2).
 *
 * ---------------------------------------------------------------------------
 * Why a week of days and not a single button
 * ---------------------------------------------------------------------------
 *
 * Getting a recipe onto a day used to be "Cook it tonight" or "Make this week" — today, or a
 * shortlist with no day at all. A household planning Thursday had to open the planner, find the
 * recipe under "Waiting for a day", and tap the day: the four-screen journey §tonight closed for
 * *today* and left open for every other day.
 *
 * This is that, for the whole week, in the place somebody is already standing.
 *
 * ---------------------------------------------------------------------------
 * Dashed is an offer, solid is a decision
 * ---------------------------------------------------------------------------
 *
 * `DayCircle`'s three states carry that distinction and this screen only uses two of them: open
 * and planned. **Nothing here suggests a day.** §67 measured what a suggestion costs when it
 * cannot state its reason, and "Thursday looks free" is not a reason — it is an observation about
 * emptiness dressed as advice. The dashed state exists for the planner, where the alongside
 * footnote can say *why*.
 */
export interface PlanDay {
  date: string;
  letter: string;
  dayOfMonth: number;
  /** the plan entry for THIS recipe on that day, when there is one */
  entryId: string | null;
  /** the weekday spelled out — the state is appended here, not by the caller */
  name: string;
  isToday: boolean;
}

export function PlanIt({ recipeId, weekLabel, days }: { recipeId: string; weekLabel: string; days: PlanDay[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(day: PlanDay) {
    if (busy) return;
    setBusy(true);
    setError(null);
    // `finally`: an offline fetch rejects, and every circle is gated on this flag
    try {
      const response = day.entryId
        ? await fetch(`/api/plan-entries/${day.entryId}`, { method: "DELETE" })
        : await fetch("/api/plan-entries", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ recipeId, date: day.date }),
          });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        /*
         * 409 is not a failure: it means the recipe is already on that day. Said plainly rather
         * than as an error, which is the shape §41 settled — refusing and silently merging are
         * both worse than saying so.
         */
        setError(
          response.status === 409
            ? "That is already on this day."
            : failed.error ?? `that did not work (${response.status})`,
        );
        return;
      }
      router.refresh();
    } catch {
      setError("No signal — that was not saved.");
    } finally {
      setBusy(false);
    }
  }

  const planned = days.filter((day) => day.entryId).length;

  return (
    <section className="h-planit">
      <div className="h-planit-head">
        <strong>Plan it · {weekLabel}</strong>
      </div>
      <div className="h-planit-days">
        {days.map((day) => (
          <DayCircle
            key={day.date}
            letter={day.letter}
            date={day.dayOfMonth}
            className={day.isToday ? "is-today" : undefined}
            state={day.entryId ? "planned" : "open"}
            /*
             * `DayCircle`'s contract is one control, one name — "Monday 19, planned" — so the
             * state belongs in the name rather than only in the fill. A screen reader otherwise
             * gets seven identical controls and `aria-pressed` alone to tell them apart, and a
             * colour is not an answer to "which days is this on".
             */
            name={`${day.isToday ? "Today, " : ""}${day.name} ${day.dayOfMonth}, ${day.entryId ? "planned" : "not planned"}`}
            onSelect={busy ? undefined : () => toggle(day)}
          />
        ))}
      </div>
      <p className="meta" style={{ margin: 0 }}>
        {planned === 0
          ? "Tap a day to put this on the week. The shopping list follows from what is planned."
          : `On ${planned} ${planned === 1 ? "day" : "days"} this week. Tap a filled day to take it off.`}
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
