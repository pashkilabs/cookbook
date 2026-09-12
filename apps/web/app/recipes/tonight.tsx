"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * What are we eating tonight.
 *
 * ---------------------------------------------------------------------------
 * The question the app could not answer
 * ---------------------------------------------------------------------------
 *
 * The word "tonight" did not appear anywhere in `apps/web`. The landing screen was the whole
 * cookbook in reverse-chronological order, so at 5pm on a Tuesday it opened on whatever was
 * saved off Instagram in August — and if the household *had* planned Tuesday, nothing on that
 * screen mentioned it.
 *
 * Getting a recipe onto *today* cost four screens: shortlist it from the recipe ("Make this
 * week" — a phrase about the week, not the evening), go to the planner, find it under "Waiting
 * for a day", tap the day. Four screens to say "we are having this in an hour".
 *
 * ---------------------------------------------------------------------------
 * Three states, and the empty one is the point
 * ---------------------------------------------------------------------------
 *
 *   planned      what it is, a link into it, and the way to record that it happened
 *   nothing      said plainly, with the shortlist offered — not an absent block
 *   cooked       so the banner stops asking about a meal already eaten
 *
 * The empty state is deliberate. An absent banner is indistinguishable from a banner that
 * failed to load, and "nothing planned" is the answer somebody most needs at 5pm.
 */
export interface TonightMeal {
  entryId: string;
  recipeId: string;
  title: string;
  timeMinutes: number | null;
  cooked: boolean;
}

export function Tonight({
  today,
  meals,
  waiting,
}: {
  today: string;
  meals: TonightMeal[];
  /** shortlisted for this week and not yet given a day — the nearest thing to a suggestion */
  waiting: Array<{ recipeId: string; title: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (path: string, method: string, body: unknown) => {
    setBusy(true);
    setError(null);
    // `finally`: an offline fetch rejects, and every control here is gated on this flag
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        setError(failed.error ?? `that did not work (${response.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No signal — that was not saved.");
    } finally {
      setBusy(false);
    }
  };

  if (meals.length > 0) {
    return (
      <aside className="tonight">
        <h2>Tonight</h2>
        {meals.map((meal) => (
          <p key={meal.entryId}>
            <Link href={`/recipes/${meal.recipeId}?planned=${meal.entryId}`}>
              <strong>{meal.title}</strong>
            </Link>
            {meal.timeMinutes && <span className="meta"> · {meal.timeMinutes} min</span>}{" "}
            {meal.cooked ? (
              <span className="meta">— cooked</span>
            ) : (
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => send(`/api/plan-entries/${meal.entryId}`, "PATCH", { cooked: true })}
              >
                Cooked it
              </button>
            )}
          </p>
        ))}
        {error && <p className="meta">{error}</p>}
      </aside>
    );
  }

  return (
    <aside className="tonight">
      <h2>Tonight</h2>
      {/* said, not omitted: an absent banner looks like one that failed to load */}
      <p className="meta">Nothing planned for tonight.</p>
      {waiting.length > 0 ? (
        <>
          <p className="meta">Waiting for a day this week — one tap puts it on tonight:</p>
          <div className="tabs">
            {waiting.slice(0, 4).map((candidate) => (
              <button
                key={candidate.recipeId}
                type="button"
                className="button quiet"
                disabled={busy}
                onClick={() =>
                  send("/api/plan-entries", "POST", { recipeId: candidate.recipeId, date: today })
                }
              >
                {candidate.title}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="meta">
          Open anything below and use <strong>Cook it tonight</strong>.
        </p>
      )}
      {error && <p className="meta">{error}</p>}
    </aside>
  );
}
