"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ServingsField } from "./servings-field";
import { Cooked, type CookMember } from "./cooked";
import { SectionHeader } from "@/components/harvest";

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
  placed: Array<{ id: string; date: string; scale: number; cookedAt: string | null; recipe: Recipe }>;
  familyId: string;
  /*
   * Plain data, keyed by recipe. A *function* here is a runtime refusal rather than a type
   * error — "Functions cannot be passed directly to Client Components" — which is why the
   * planner 500'd in production with a green `pnpm check`.
   */
  membersByRecipe: Record<string, CookMember[]>;
  /** each recipe's component names, so a surplus is kept against the part it is (§69) */
  partsByRecipe: Record<string, string[]>;
  waiting: Array<{ id: string; recipe: Recipe }>;
  /**
   * What this household's children have consistently rated low, for the recipes waiting.
   *
   * Shown at the moment a meal is being planned rather than after, because that is when it can
   * change a decision. Never blocking: it is an observation about the ratings, and a household
   * knows things the ratings do not.
   */
  warnings: Record<string, Array<{ displayName: string; value: string; count: number }>>;
  /** signed thumbnail URLs by recipe id — plain data, for the reason `membersByRecipe` gives */
  photoFor: Record<string, string>;
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

  /*
   * `finally`, for the reason `shopping-list.tsx` documents at length: an offline `fetch`
   * rejects, so a `setBusy(null)` after the await never runs and every control bound to
   * `disabled={busy !== null}` stays dead. Same shape, same screen-wide consequence.
   */
  async function call(key: string, path: string, method: string, body?: unknown) {
    setBusy(key);
    setError(null);
    try {
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
          return false;
        }

        setError(failed.error ?? `that did not work (${response.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("No signal — that one was not saved. Try it again in a moment.");
      return false;
    } finally {
      setBusy(null);
    }
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

      <section id="waiting" className="h-waiting">
        <SectionHeader>Waiting for a day</SectionHeader>
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
                {/*
                  * Worded as what was rated, not as what a child is like: "Ada has rated 8 fish
                  * dishes low" is a fact somebody can weigh, where "Ada does not like fish" is a
                  * claim about a person made by a database. The count is always shown.
                  */}
                {(props.warnings[recipe.id] ?? []).map((warning) => (
                  <span key={`${warning.displayName}-${warning.value}`} className="meta warning">
                    {warning.displayName} has rated {warning.count} {warning.value} recipes low
                  </span>
                ))}
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

      <div className="h-week">
        {props.days.map((day) => {
          const forDay = props.placed.filter((entry) => entry.date === day.date);
          return (
            <section key={day.date} className={day.date === props.today ? "h-day-row is-today" : "h-day-row"}>
              {/*
                * The date block §4.4 asks for: three-letter weekday over the day of the month.
                * `aria-hidden`, with the whole date in the row's own label — "SUN 18" read as two
                * fragments before a recipe name is noise, the same reasoning `DayCircle` carries.
                */}
              <div className="h-day-date" aria-hidden="true">
                <span>{day.weekday.slice(0, 3).toUpperCase()}</span>
                <strong>{day.label.replace(/[^0-9]/g, "")}</strong>
              </div>

              <div className="h-day-body">
                <h3 className="h-sr-only">
                  {day.weekday} {day.label}
                  {day.date === props.today ? ", today" : ""}
                </h3>

              {/*
                * An empty day is an invitation, not a dash (§4.4).
                *
                * It points at the waiting list when something is waiting and at the recipe list
                * when nothing is, because those are the two real next moves — a button that
                * opens a picker this app does not have would be a control with nothing behind it.
                * Dashed rather than filled, which is the same grammar `DayCircle` uses: an offer
                * is dashed, a decision is solid.
                */}
              {forDay.length === 0 && (
                <Link
                  className="h-add-dinner"
                  href={props.waiting.length > 0 ? "#waiting" : "/recipes"}
                  aria-label={`Add dinner for ${day.weekday} ${day.label}`}
                >
                  + Add dinner
                </Link>
              )}

              {forDay.map((entry) => (
                <div className="h-day-entry" key={entry.id}>
                  <div className="h-day-meal">
                    <div className="h-day-text">
                      {/* carries the plan entry, so the recipe opens at the servings it was planned for */}
                      <Link className="h-day-title" href={`/recipes/${entry.recipe.id}?planned=${entry.id}`}>
                        {entry.recipe.title}
                      </Link>
                      {/*
                        * §4.4 asks this line to carry "leftovers, shared ingredients" as well as
                        * the time. It carries the time.
                        *
                        * Both of the others already live somewhere, for recorded reasons, and
                        * putting a second copy here would be a second answer to one question —
                        * the way two parsers came to drift. **Leftovers** are the shopping list's,
                        * because only it knows package sizes, so only it knows what is actually
                        * spare; `alongside.tsx` says so in as many words. **Shared ingredients**
                        * are §67's footnote below the week, and its header argues specifically
                        * against moving them beside a day.
                        *
                        * So this is the reference asking for something the app deliberately keeps
                        * elsewhere, which is a third thing a reference screen can be — not a
                        * styling choice, and not the app lying either.
                        */}
                      {entry.recipe.time_minutes !== null && (
                        <p className="h-day-meta">{entry.recipe.time_minutes} min</p>
                      )}
                    </div>
                    {/* no text over it, ever (§5) — the thumbnail sits beside the name */}
                    {props.photoFor[entry.recipe.id] ? (
                      <img className="h-day-thumb" src={props.photoFor[entry.recipe.id]} alt="" />
                    ) : (
                      <span className="h-day-thumb is-empty" aria-hidden="true">
                        {entry.recipe.title.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                    )}
                  </div>
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
                    {/*
                      * Moving a meal, as a select rather than a drag.
                      *
                      * reported: meals could not move between weeks at all — the PATCH updated
                      * only `scale`. A select works with one thumb on a phone, where dragging
                      * between two days that are not both on screen does not.
                      *
                      * The two week options move the meal to the same weekday seven days either
                      * side, which is what "not this week, next week" means in practice and needs
                      * no second calendar to express.
                      */}
                    {/*
                      * On the day, next to the meal. The moment a household knows something was
                      * cooked is the evening it was cooked, and this is the screen they are
                      * looking at then — asking them to open the recipe later is why there were
                      * two ratings against twenty-eight planned dinners.
                      */}
                    <Cooked
                      entryId={entry.id}
                      familyId={props.familyId}
                      recipeId={entry.recipe.id}
                      cookedAt={entry.cookedAt}
                      members={props.membersByRecipe[entry.recipe.id] ?? []}
                      parts={props.partsByRecipe[entry.recipe.id] ?? []}
                      disabled={busy !== null}
                    />
                    <select
                      aria-label="Move to another day"
                      className="quiet"
                      value=""
                      disabled={busy !== null}
                      onChange={(event) => {
                        const date = event.target.value;
                        if (!date) return;
                        call(`move-${entry.id}`, `/api/plan-entries/${entry.id}`, "PATCH", { date });
                      }}
                    >
                      <option value="">Move…</option>
                      {props.days
                        .filter((option) => option.date !== entry.date)
                        .map((option) => (
                          <option key={option.date} value={option.date}>
                            {option.weekday}
                          </option>
                        ))}
                      <option value={shiftDays(entry.date, 7)}>→ next week</option>
                      <option value={shiftDays(entry.date, -7)}>← last week</option>
                    </select>
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy !== null}
                      title="Take it off this day — it goes back to the waiting list"
                      onClick={() => call(`remove-${entry.id}`, `/api/plan-entries/${entry.id}`, "DELETE")}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/**
 * The same weekday, a number of days away — in plain ISO, not through a Date.
 *
 * `new Date("2026-09-14")` parses as UTC midnight and renders in local time, so west of
 * Greenwich a day can arrive as the evening before. Counting days on the calendar avoids the
 * timezone entirely, which matters because a meal moved to "next Tuesday" landing on Monday is
 * exactly the kind of off-by-one nobody notices until the shopping list is wrong.
 */
function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
