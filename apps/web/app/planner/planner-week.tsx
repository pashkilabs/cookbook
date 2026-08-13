"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SCALES } from "@/lib/planner";

/**
 * The week, and the writes that arrange it.
 *
 * Everything goes through route handlers rather than direct table writes, so one place decides
 * that the week's `meal_plans` row exists, that a recipe belongs to this household, and that
 * placing a recipe takes it off the shortlist. A refusal from a read-only household arrives here
 * as the plain-English message the route already produced.
 *
 * The whole week re-renders after a write (`router.refresh()`) rather than being patched in
 * place. For seven days and a handful of entries that is cheaper than keeping two copies of the
 * truth, and it means a second device's changes appear on the next interaction.
 */
interface Recipe {
  id: string;
  title: string;
  servings: number | null;
  time_minutes: number | null;
}

export function PlannerWeek(props: {
  weekStart: string;
  today: string;
  days: Array<{ date: string; weekday: string; label: string }>;
  placed: Array<{ id: string; date: string; scale: number; recipe: Recipe }>;
  waiting: Array<{ id: string; recipe: Recipe }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function call(key: string, path: string, method: string, body?: unknown) {
    setBusy(key);
    setError(null);
    const response = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const failed = (await response.json().catch(() => ({}))) as { error?: string };
      setError(failed.error ?? `that did not work (${response.status})`);
      setBusy(null);
      return false;
    }
    setBusy(null);
    router.refresh();
    return true;
  }

  const place = (recipeId: string, date: string) =>
    call(`place-${recipeId}-${date}`, "/api/plan-entries", "POST", { recipeId, date });

  return (
    <>
      {error && <p className="error">{error}</p>}

      <section>
        <h2>Waiting for a day</h2>
        {props.waiting.length === 0 ? (
          <p className="meta">
            Nothing shortlisted for this week. Mark a recipe <em>make this week</em> from{" "}
            <Link href="/recipes">the list</Link> or its own page, and it will appear here.
          </p>
        ) : (
          <ul className="waiting">
            {props.waiting.map(({ id, recipe }) => (
              <li key={id}>
                <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
                <span className="days">
                  {props.days.map((day) => (
                    <button
                      key={day.date}
                      type="button"
                      className="quiet"
                      disabled={busy !== null}
                      title={`Cook on ${day.weekday} ${day.label}`}
                      onClick={() => place(recipe.id, day.date)}
                    >
                      {day.weekday.slice(0, 3)}
                    </button>
                  ))}
                </span>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy !== null}
                  onClick={() =>
                    call(`unshortlist-${recipe.id}`, "/api/shortlist", "DELETE", {
                      recipeId: recipe.id,
                      weekStart: props.weekStart,
                    })
                  }
                >
                  Not this week
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="week">
        {props.days.map((day) => {
          const forDay = props.placed.filter((entry) => entry.date === day.date);
          return (
            <section key={day.date} className={day.date === props.today ? "day today" : "day"}>
              <h3>
                {day.weekday} <span className="meta">{day.label}</span>
              </h3>

              {forDay.length === 0 && <p className="meta">—</p>}

              {forDay.map((entry) => (
                <div className="entry" key={entry.id}>
                  <Link href={`/recipes/${entry.recipe.id}`}>{entry.recipe.title}</Link>
                  <p className="meta" style={{ margin: "0.15rem 0 0.4rem" }}>
                    {[
                      entry.recipe.servings
                        ? `${Math.round(entry.recipe.servings * entry.scale)} servings`
                        : null,
                      entry.recipe.time_minutes ? `${entry.recipe.time_minutes} min` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <span className="scale">
                    {SCALES.map((scale) => (
                      <button
                        key={scale}
                        type="button"
                        aria-pressed={entry.scale === scale}
                        className={entry.scale === scale ? "" : "quiet"}
                        disabled={busy !== null}
                        title={`Cook ${scale}× the recipe`}
                        onClick={() =>
                          call(`scale-${entry.id}`, `/api/plan-entries/${entry.id}`, "PATCH", { scale })
                        }
                      >
                        {scale}×
                      </button>
                    ))}
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy !== null}
                      title="Take it off this day"
                      onClick={() => call(`remove-${entry.id}`, `/api/plan-entries/${entry.id}`, "DELETE")}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
