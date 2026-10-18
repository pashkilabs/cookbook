"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip, Eyebrow } from "@/components/harvest";

/**
 * Today's meals, and the choosing of one.
 *
 * ---------------------------------------------------------------------------
 * What "+ Add breakfast" does, which is the part the spec left open
 * ---------------------------------------------------------------------------
 *
 * It could not simply link to the library: `plan_entries.slot` is set by the route and nothing
 * on `/recipes` carries a slot, so a recipe chosen there would arrive as `dinner` — the column
 * default — under a button that said breakfast. **A control that produces something other than
 * what it says is the app lying** (§78), and it is worse here than an omission because the
 * database would record it as fact.
 *
 * So choosing happens on this screen. Tapping "+ Add breakfast" puts the screen into *choosing
 * breakfast*, said out loud in a banner with a way out, and the plan control on each suggestion
 * then writes that slot for today. One state, visible, no cross-screen hand-off to lose it.
 *
 * Out of that mode the same control **shortlists for this week**, which is what the spec expects
 * and matches "Make this week" rather than inventing a third path onto a day. Two behaviours on
 * one button is a thing this project is wary of — the planner's title does it by day — and the
 * difference is legitimate here for the same reason it was there: *the mode is on screen in
 * words*, not inferred.
 */
export const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Slot = (typeof SLOTS)[number];

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
  memberCount,
  stillToBuy,
}: {
  today: string;
  weekStart: string;
  meals: PlannedMeal[];
  suggestions: Suggestion[];
  memberCount: number;
  stillToBuy: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<Slot | null>(null);
  const [shortlisted, setShortlisted] = useState<string[]>([]);

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

  const plan = async (recipeId: string) => {
    if (choosing) {
      const ok = await call(`plan-${recipeId}`, "/api/plan-entries", {
        recipeId,
        date: today,
        slot: choosing,
      });
      if (ok) {
        setChoosing(null);
        router.refresh();
      }
      return;
    }
    const ok = await call(`short-${recipeId}`, "/api/shortlist", { recipeId, weekStart });
    if (ok) setShortlisted((current) => [...current, recipeId]);
  };

  const bySlot = new Map<Slot, PlannedMeal[]>();
  for (const meal of meals) bySlot.set(meal.slot, [...(bySlot.get(meal.slot) ?? []), meal]);

  return (
    <>
      {error && <p className="error">{error}</p>}

      {/* the mode, in words, with a way out — see the header for why it is not implicit */}
      {choosing && (
        <div className="h-choosing" role="status">
          <span>
            Choosing <strong>{choosing}</strong> for today — pick one below.
          </span>
          <button type="button" className="h-chip" onClick={() => setChoosing(null)}>
            Cancel
          </button>
        </div>
      )}

      {SLOTS.map((slot) => {
        const forSlot = bySlot.get(slot) ?? [];
        if (forSlot.length === 0) return null;
        return (
          <section className="h-slot" key={slot}>
            <Eyebrow>{slot}</Eyebrow>
            {forSlot.map((meal) => (
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
                </div>

                {/*
                  * One number, from one place. `stillToBuy` is counted by `buildShoppingWeek` —
                  * the function the shopping screen renders — so the card and the list it links
                  * to cannot disagree. Null means the week could not be built, and then this says
                  * nothing rather than guessing at zero.
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
                    * Swap opens the week, which is where a meal moves or comes off — the planner
                    * owns Move and remove. A second mechanism for replacing a meal would be two
                    * implementations of one question, so this is a route into the existing one
                    * rather than a new control.
                    */}
                  <Link className="h-secondary" href={`/planner?week=${weekStart}`}>
                    Swap
                  </Link>
                </div>
              </article>
            ))}
          </section>
        );
      })}

      {/*
        * A dashed invitation per empty slot — the grammar `DayCircle` and "+ Add dinner" already
        * use: an offer is dashed, a decision is solid.
        */}
      <div className="h-slot-adds">
        {SLOTS.filter((slot) => (bySlot.get(slot) ?? []).length === 0).map((slot) => (
          <button
            key={slot}
            type="button"
            className={choosing === slot ? "h-add-dinner is-choosing" : "h-add-dinner"}
            aria-pressed={choosing === slot}
            disabled={busy !== null}
            onClick={() => setChoosing(choosing === slot ? null : slot)}
          >
            + Add {slot}
          </button>
        ))}
      </div>

      {suggestions.length > 0 && (
        <section className="h-board">
          <div className="h-board-head">
            <h2 className="h-board-title">What everyone likes</h2>
            <span className="h-meal-meta">
              Household · {memberCount}
            </span>
          </div>
          {/*
            * The sentence that keeps the chips honest. Every figure below is a number of people,
            * and saying so is what stops "3 of 5" reading as a score out of five.
            */}
          <p className="h-board-note">Counted from what each person has rated. Nothing is averaged.</p>

          {suggestions.map((row) => (
            <article className="h-board-row" key={row.id}>
              <div className="h-board-text">
                <Link className="h-board-name" href={`/recipes/${row.id}`}>
                  {row.title}
                </Link>
                <div className="h-board-chips">
                  <Chip>
                    {row.liked} of {row.rated} liked it
                  </Chip>
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
              <button
                type="button"
                className="h-board-plan"
                disabled={busy !== null || shortlisted.includes(row.id)}
                aria-label={
                  choosing
                    ? `Plan ${row.title} for ${choosing} today`
                    : `Make ${row.title} this week`
                }
                onClick={() => void plan(row.id)}
              >
                {shortlisted.includes(row.id) ? "✓" : "+"}
              </button>
            </article>
          ))}

          <Link className="h-board-all" href="/recipes">
            See every recipe
          </Link>
        </section>
      )}
    </>
  );
}
