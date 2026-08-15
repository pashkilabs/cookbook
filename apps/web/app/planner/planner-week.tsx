"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ServingsField } from "./servings-field";

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
  const [duplicate, setDuplicate] = useState<{
    entryId: string;
    title: string;
    servings: number | null;
    recipeServings: number | null;
    scale: number;
  } | null>(null);
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
      const failed = (await response.json().catch(() => ({}))) as {
        error?: string;
        existing?: { id: string; servings: number | null; scale: number };
        recipe?: { title: string; servings: number | null };
      };

      /*
       * Already on that day. Not merged silently and not refused — the household is told, and
       * offered the thing they almost certainly meant: feed more people from the one entry
       * (decisions §41).
       */
      if (response.status === 409 && failed.error === "already-planned" && failed.existing) {
        setDuplicate({
          entryId: failed.existing.id,
          title: failed.recipe?.title ?? "That recipe",
          servings: failed.existing.servings,
          recipeServings: failed.recipe?.servings ?? null,
          scale: failed.existing.scale,
        });
        setBusy(null);
        return false;
      }

      setError(failed.error ?? `that did not work (${response.status})`);
      setBusy(null);
      return false;
    }
    setBusy(null);
    router.refresh();
    return true;
  }

  const place = (recipeId: string, date: string) => {
    setDuplicate(null);
    return call(`place-${recipeId}-${date}`, "/api/plan-entries", "POST", { recipeId, date });
  };

  const moreServings = duplicate
    ? (duplicate.servings ?? 0) + (duplicate.recipeServings ?? 0)
    : 0;

  return (
    <>
      {error && <p className="error">{error}</p>}

      {/*
        * Already planned. Said out loud, with the thing they almost certainly meant one tap away —
        * a household adding a recipe to a day it is already on wants more food, not two entries.
        */}
      {duplicate && (
        <div className="notice">
          <p style={{ margin: 0 }}>
            <strong>{duplicate.title}</strong> is already on that day
            {duplicate.servings ? `, for ${duplicate.servings}` : ""}.
          </p>
          <div className="tabs" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            {duplicate.recipeServings && duplicate.servings ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  const ok = await call(
                    `more-${duplicate.entryId}`,
                    `/api/plan-entries/${duplicate.entryId}`,
                    "PATCH",
                    { servings: moreServings },
                  );
                  if (ok) setDuplicate(null);
                }}
              >
                Feed {moreServings} instead
              </button>
            ) : null}
            <button
              type="button"
              className="quiet"
              disabled={busy !== null}
              onClick={() => setDuplicate(null)}
            >
              Leave it as it is
            </button>
          </div>
        </div>
      )}

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
                  {/* carries the plan entry, so the recipe opens at the servings it was planned for */}
                  <Link href={`/recipes/${entry.recipe.id}?planned=${entry.id}`}>{entry.recipe.title}</Link>
                  {entry.recipe.time_minutes && (
                    <p className="meta" style={{ margin: "0.15rem 0 0.4rem" }}>
                      {entry.recipe.time_minutes} min
                    </p>
                  )}
                  <span className="scale">
                    <ServingsField
                      entryId={entry.id}
                      scale={entry.scale}
                      recipeServings={entry.recipe.servings}
                      busy={busy !== null}
                      onSave={(patch) =>
                        call(`scale-${entry.id}`, `/api/plan-entries/${entry.id}`, "PATCH", patch)
                      }
                    />
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
