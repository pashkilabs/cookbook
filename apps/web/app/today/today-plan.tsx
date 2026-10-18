"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip, SegmentedControl } from "@/components/harvest";
import { SLOTS, SLOT_LABEL, SLOT_NOUN, type Slot } from "@/lib/slots";

/**
 * Today's meals, and the choosing of one.
 *
 * ---------------------------------------------------------------------------
 * The tab is the mode, which replaces a banner
 * ---------------------------------------------------------------------------
 *
 * v1 had a *choosing breakfast* banner: tapping a dashed "+ Add breakfast" put the screen into a
 * mode, said so in a strip, and the `+` controls then wrote that slot. It worked and it had two
 * faults. The slot set **what got written and not what got shown**, so choosing breakfast offered
 * dinners; and a banner is a thing you can scroll past, so the mode could be true and invisible.
 *
 * The tabs fix both at once. The tab scopes the planned meal, the leaderboard and what a `+`
 * writes, and it is at the top of the screen at all times — **a control that is always visible is
 * strictly better than a state you have to remember**, which is the same argument the planner's
 * "tap to cook" cue made about a conditional destination.
 *
 * `+` therefore always plans into the visible slot for today. The shortlist behaviour v1 used
 * outside choosing mode is gone with the mode: there is no longer a state in which the screen does
 * not know which meal you mean.
 */

export interface PlannedMeal {
  entryId: string;
  recipeId: string;
  slot: Slot;
  title: string;
  timeMinutes: number | null;
  servings: number | null;
  cooked: boolean;
}

export interface Suggestion {
  id: string;
  title: string;
  liked: number;
  rated: number;
  untried: number;
  lukewarm: Array<{ name: string; score: number }>;
  timesMade: number;
}

export function TodayPlan({
  today,
  weekStart,
  meals,
  suggestions,
  slot,
  slotTotal,
  anyRated,
  memberCount,
  stillToBuy,
  photoFor,
}: {
  today: string;
  weekStart: string;
  meals: PlannedMeal[];
  suggestions: Suggestion[];
  memberCount: number;
  slot: Slot;
  /** how many recipes this tab covers at all, for the link to the library */
  slotTotal: number;
  /** false when nothing in this course is rated — the rows are then an unranked list */
  anyRated: boolean;
  stillToBuy: number | null;
  /** signed URLs by recipe id — plain data, for the reason `membersByRecipe` gives on the planner */
  photoFor: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planned, setPlanned] = useState<string[]>([]);

  async function call(key: string, path: string, body: unknown) {
    setBusy(key);
    setError(null);
    // `finally` for the flag and `catch` for the message — one rejection, two consequences (§80)
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        setError(
          response.status === 409
            ? "That is already on today."
            : failed.error ?? `that did not work (${response.status})`,
        );
        return false;
      }
      return true;
    } catch {
      setError("No signal — that was not saved. Try it again in a moment.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  /* always the visible slot: there is no mode in which the screen does not know which meal */
  const plan = async (recipeId: string) => {
    const ok = await call(`plan-${recipeId}`, "/api/plan-entries", { recipeId, date: today, slot });
    if (ok) {
      setPlanned((current) => [...current, recipeId]);
      router.refresh();
    }
  };

  const noun = SLOT_NOUN[slot];

  return (
    <>
      {error && <p className="error">{error}</p>}

      {/*
        * The tabs. A link per slot rather than client state, so the chosen tab survives a reload
        * and a back press, and the server picks the content — which is what keeps the time-of-day
        * default from flipping after hydration.
        */}
      <div className="h-slot-tabs">
        <SegmentedControl
          segments={SLOTS.map((value) => ({ value, label: SLOT_LABEL[value] }))}
          value={slot}
          onChange={(next) => router.push(`/today?slot=${next}`)}
          label="Which meal"
        />
      </div>

      {meals.length === 0 ? (
        /*
         * "No breakfast planned" — one of two empty states this screen has, and they must read
         * differently. This one is about the *plan*; the leaderboard's is about the *ratings*, and
         * conflating them would tell somebody nobody has rated a breakfast when the truth is that
         * nobody has planned one.
         */
        <section className="h-today-empty">
          <p className="h-today-empty-title">No {noun.one} planned.</p>
          <p>
            Pick one below, or <Link href={`/planner?week=${weekStart}`}>open the week</Link>.
          </p>
        </section>
      ) : (
        meals.map((meal) => (
          <article className="h-meal-card" key={meal.entryId}>
            <div className="h-meal-head">
              <div className="h-meal-text">
                <h2 className="h-meal-title">{meal.title}</h2>
                <p className="h-meal-meta">
                  {[
                    meal.timeMinutes !== null ? `${meal.timeMinutes} min` : null,
                    meal.servings !== null ? `serves ${meal.servings}` : null,
                    meal.cooked ? "cooked" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {/* no text over it, ever (§5) — the photograph sits beside the name */}
              {photoFor[meal.recipeId] ? (
                <img className="h-meal-photo" src={photoFor[meal.recipeId]} alt="" />
              ) : (
                <span className="h-meal-photo is-empty" aria-hidden="true">
                  {meal.title.trim().charAt(0).toUpperCase() || "?"}
                </span>
              )}
            </div>

            {/*
              * One number, from one place. `stillToBuy` is counted by `buildShoppingWeek` — the
              * function the shopping screen renders — so the card and the list it links to cannot
              * disagree. Null means the week could not be built, and then this says nothing rather
              * than guessing at zero.
              */}
            {stillToBuy !== null && (
              <p className="h-meal-buy">
                {stillToBuy === 0 ? (
                  <>Everything for this week is bought.</>
                ) : (
                  <>
                    Still to buy:{" "}
                    <strong>
                      {stillToBuy} {stillToBuy === 1 ? "thing" : "things"}
                    </strong>{" "}
                    <Link href={`/shopping?week=${weekStart}`}>see the list</Link>
                  </>
                )}
              </p>
            )}

            <div className="h-meal-actions">
              {/* ?planned= so cook mode shows the amounts this meal was planned at */}
              <Link className="h-primary" href={`/cook/${meal.recipeId}?planned=${meal.entryId}`}>
                Start cooking
              </Link>
              {/*
                * Swap opens the week, which is where a meal moves or comes off — the planner owns
                * Move and remove. A second mechanism for replacing a meal would be two
                * implementations of one question.
                */}
              <Link className="h-secondary" href={`/planner?week=${weekStart}`}>
                Swap
              </Link>
            </div>
          </article>
        ))
      )}

      {/*
        * ---------------------------------------------------------------------------
        * Three empty states, and they mean different things
        * ---------------------------------------------------------------------------
        *
        * The spec named two — nothing *planned* for this slot, and nothing *rated* in this course.
        * A third turned up the moment a tab was pointed at a course the library has none of: the
        * smoke household owns no breakfast recipes, so there was nothing to rank and nothing to
        * list, and the screen fell through to a sentence about ratings. "Nobody has rated a
        * breakfast yet" is wrong when the truth is there are no breakfasts.
        *
        *   nothing planned   handled above — "No breakfast planned."
        *   nothing rated     the leaderboard renders unranked rows, chipped
        *   nothing at all    this: say so, and point at the place recipes come from
        *
        * Absent and "too few to say" are the two this project keeps having to distinguish; this is
        * the third, and it is the one where the honest answer is a different sentence entirely.
        */}
      {suggestions.length === 0 ? (
        <section className="h-today-quiet">
          <p>
            No {noun.many} in your recipes yet. <Link href="/recipes/import">Import one</Link>, or
            set a course on a recipe you already have from{" "}
            <Link href="/recipes">the library</Link>.
          </p>
        </section>
      ) : (
        <section className="h-board">
          <div className="h-board-head">
            <h2 className="h-board-title">
              {noun.many.charAt(0).toUpperCase() + noun.many.slice(1)} everyone likes
            </h2>
            <span className="h-meal-meta">
              Household · {memberCount}
            </span>
          </div>
          {/*
            * The sentence that keeps the chips honest. Every figure below is a number of people,
            * and saying so is what stops "3 of 5" reading as a score out of five.
            */}
          {/*
            * Two different sentences, because the two empty states mean opposite things. "Nobody
            * has rated a breakfast yet" is about the ratings; "No breakfast planned" above is
            * about the plan. Saying the ratings line when the real state is an unplanned meal
            * would be the screen answering a question nobody asked.
            */}
          <p className="h-board-note">
            {anyRated
              ? "Counted from what each person has rated. Nothing is averaged."
              : `Nobody has rated a ${noun.one} yet — once a few are cooked and scored, they rank here.`}
          </p>

          {suggestions.map((row) => (
            <article className="h-board-row" key={row.id}>
              {/*
                * A leaderboard of text rows reads as a list; with photographs it reads as a
                * shelf, which is what somebody scanning for dinner is actually doing (§56).
                */}
              {photoFor[row.id] ? (
                <img className="h-board-photo" src={photoFor[row.id]} alt="" loading="lazy" />
              ) : (
                <span className="h-board-photo is-empty" aria-hidden="true">
                  {row.title.trim().charAt(0).toUpperCase() || "?"}
                </span>
              )}
              <div className="h-board-text">
                <Link className="h-board-name" href={`/recipes/${row.id}`}>
                  {row.title}
                </Link>
                <div className="h-board-chips">
                  {/*
                    * An unrated row says so instead of "0 of 0 liked it", which is a count of
                    * nothing dressed as a verdict. §83 measured that this is the normal state:
                    * 10 of 66 recipes carry any rating at all.
                    */}
                  {row.rated === 0 ? (
                    <span className="h-chip-quiet">nobody has rated it</span>
                  ) : (
                    <Chip>
                      {row.liked} of {row.rated} liked it
                    </Chip>
                  )}
                  {row.timesMade > 0 && <Chip tone="clay">made {row.timesMade}×</Chip>}
                  {/*
                    * Named, with the score they gave. Not "said no": the lowest rating anybody in
                    * this household has given is a 3, and a 3 is lukewarm rather than a refusal.
                    * The planner's warnings take the same line — report what was rated, not a
                    * claim about the person.
                    */}
                  {row.lukewarm.map((who) => (
                    <span className="h-chip-quiet" key={who.name}>
                      {who.name} rated it {who.score}
                    </span>
                  ))}
                  {row.untried > 0 && (
                    <span className="h-chip-quiet">
                      {row.untried} {row.untried === 1 ? "hasn't" : "haven't"} tried it
                    </span>
                  )}
                </div>
              </div>
              {/* the slot is in the name, because the glyph is a `+` on every row */}
              <button
                type="button"
                className="h-board-plan"
                disabled={busy !== null || planned.includes(row.id)}
                aria-label={`Plan ${row.title} for ${noun.one} today`}
                onClick={() => void plan(row.id)}
              >
                {planned.includes(row.id) ? "✓" : "+"}
              </button>
            </article>
          ))}

          {/*
            * The count is this tab's, not the library's — "See all 41 dinners" rather than "see
            * every recipe", because a reader on the Dinner tab is asking about dinners. It counts
            * what the tab *covers*, which includes unrated ones, so it is larger than the rows
            * above and that is the point of the link.
            */}
          <Link className="h-board-all" href="/recipes">
            See all {slotTotal} {slotTotal === 1 ? noun.one : noun.many}
          </Link>
        </section>
      )}
    </>
  );
}
