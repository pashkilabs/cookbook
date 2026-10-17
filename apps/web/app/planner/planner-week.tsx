"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ServingsField } from "./servings-field";
import { Cooked, type CookMember } from "./cooked";
import { SectionHeader } from "@/components/harvest";
import { useDragToDay } from "./use-drag-to-day";

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
   * One row open at a time. A week with four panels expanded is the same crowding one level up —
   * and the row at rest is the thing worth reading, so the default for all seven is closed.
   */
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  /*
   * Bring an opened panel into view, because the page's `padding-bottom` reserves room at the
   * END of the document and says nothing about a panel that grows in the middle of it. Expanding
   * the sixth row put its controls behind the docked tab bar with nothing to scroll to, since
   * the page was already as long as it was going to get.
   *
   * `block: "nearest"` scrolls the minimum needed and leaves a panel already in view alone;
   * `.h-day-panel`'s `scroll-margin-bottom` is what keeps the bar's height out of the way, which
   * is the property that exists for exactly this and is better than arithmetic here.
   */
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (openEntry && panel.current) panel.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [openEntry]);

  /*
   * Press and hold a meal, drag to another day, pause to settle; swipe left to send it to next
   * week. Both write through the same routes the select and the ✕ already use, so a drag is a
   * second way to reach one behaviour rather than a second implementation of it.
   *
   * The select stays, and not only as a fallback: it is the keyboard path, the mouse path, and
   * what a dropped gesture degrades to.
   */
  const drag = useDragToDay({
    onMoveToDate: (entryId, date) => {
      void call(`move-${entryId}`, `/api/plan-entries/${entryId}`, "PATCH", { date });
    },
    onSendToNextWeek: (entryId) => {
      const entry = props.placed.find((candidate) => candidate.id === entryId);
      if (!entry) return;
      void call(`move-${entryId}`, `/api/plan-entries/${entryId}`, "PATCH", {
        date: shiftDays(entry.date, 7),
      });
    },
    // nothing is draggable while a write is in flight, for the reason every other control here is
    // disabled: two moves racing would leave the week disagreeing with the database
    enabled: busy === null,
  });

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
            <section
              key={day.date}
              /* measured on drag start, in document coordinates — see lib/drag-geometry.ts */
              ref={(node) => drag.register(day.date, node)}
              className={
                [
                  "h-day-row",
                  day.date === props.today ? "is-today" : "",
                  drag.settledOn === day.date ? "is-settled" : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
            >
              {/*
                * The date block §4.4 asks for: three-letter weekday over the day of the month.
                * `aria-hidden`, with the whole date in the row's own label — "SUN 18" read as two
                * fragments before a recipe name is noise, the same reasoning `DayCircle` carries.
                */}
              {/*
                * The date block is also the drag handle, and that is a correction.
                *
                * The gesture was bound to the whole entry with `touch-action: auto` restored on
                * its links — so pressing the **meal name**, which is the row's largest target
                * and the obvious thing to press, did nothing: iOS claimed the long-press for its
                * own link callout and fired `pointercancel`. "Press and hold does nothing" was
                * accurate about the only place anybody would try.
                *
                * Making the title draggable would ask one element to mean tap-to-cook,
                * long-press-to-drag and tap-elsewhere-to-expand. A handle is the honest answer:
                * not a link, not selectable text, already `aria-hidden`, 44px wide, at the left
                * edge where a thumb rests. `-webkit-touch-callout` and `user-select` are off on
                * it, which is what stops iOS taking the press first.
                */}
              <div
                className="h-day-date"
                data-entry-id={forDay[0]?.id}
                aria-hidden="true"
                {...(forDay.length === 1 ? drag.handlers : {})}
              >
                <span>{day.weekday.slice(0, 3).toUpperCase()}</span>
                <strong>{day.label.replace(/[^0-9]/g, "")}</strong>
                {/* a grip, so the handle is discoverable rather than a thing to be told about */}
                {forDay.length === 1 && (
                  <svg className="h-grip" width="14" height="6" viewBox="0 0 14 6" aria-hidden="true">
                    <circle cx="2" cy="2" r="1" fill="currentColor" />
                    <circle cx="7" cy="2" r="1" fill="currentColor" />
                    <circle cx="12" cy="2" r="1" fill="currentColor" />
                  </svg>
                )}
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

              {forDay.map((entry) => {
                const isOpen = openEntry === entry.id;
                return (
                <div
                  key={entry.id}
                  data-entry-id={entry.id}
                  className={
                    [
                      "h-day-entry",
                      isOpen ? "is-open" : "",
                      drag.dragging === entry.id ? "is-dragging" : "",
                      drag.dragging === entry.id && drag.sendingNext ? "is-sending-next" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")
                  }
                >
                  {/*
                    * The whole row is the disclosure, and the title is still a link.
                    *
                    * An absolutely-positioned button beneath the content, with the link and the
                    * cooked mark lifted above it — rather than a `<button>` wrapping a `<Link>`,
                    * which is invalid and would make every tap on the title do both things. Both
                    * controls stay in the tab order, and a row at rest holds exactly what §4.4
                    * asks for: the date, the title, the time and the photograph.
                    *
                    * A chevron would be a fifth thing competing for the same width, so the hint
                    * is the row's own affordance and the control is `aria-expanded`.
                    */}
                  <button
                    type="button"
                    className="h-day-expand"
                    aria-expanded={isOpen}
                    aria-controls={`entry-${entry.id}`}
                    aria-label={`${isOpen ? "Hide" : "Show"} what you can do with ${entry.recipe.title}`}
                    onClick={() => setOpenEntry(isOpen ? null : entry.id)}
                  />
                  <div className="h-day-meal">
                    <div className="h-day-text">
                      {/*
                        * ---------------------------------------------------------------------
                        * Today's title opens cook mode. Every other day's opens the recipe.
                        * ---------------------------------------------------------------------
                        *
                        * The intent is right — on the planner the decision is already made, so
                        * the next action is cooking rather than reading. But that is true *of
                        * tonight*. Thursday's dinner is four days away and nobody is standing at
                        * a hob: it is something you check, or shop for, or change your mind
                        * about. And Monday's, already eaten, is something you look back at.
                        * Sending all three to a step-by-step screen would be right once in seven.
                        *
                        * `today` is already `todayIso(family.timezone)`, computed on the server
                        * and passed in — the household's day, not the device's, which is the
                        * split that column exists to close.
                        *
                        * **The cost is that one control does two things**, and this project's own
                        * rule is that nothing on screen should be a claim a person cannot check.
                        * So the difference is *said*: today's row carries "tap to cook" on its
                        * meta line. A conditional destination with a visible cue is a different
                        * thing from one you have to learn.
                        *
                        * `?planned=` on both, or the scaled servings are lost on the way — a
                        * meal planned for nine opening as a recipe for four is the worst way for
                        * this to be wrong, because nothing on the screen would look wrong.
                        */}
                      <Link
                        className="h-day-title"
                        href={
                          day.date === props.today
                            ? `/cook/${entry.recipe.id}?planned=${entry.id}`
                            : `/recipes/${entry.recipe.id}?planned=${entry.id}`
                        }
                      >
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
                      {/*
                        * The meta line, which is where the cooked mark belongs — "35 min ·
                        * Cooked" is a line of facts about the meal, and it costs vertical space
                        * rather than competing with the thumbnail for width. Four 44px controls
                        * beside a 56px photograph and a 44px date block left 170px for a title
                        * on a phone, which is what overcrowded actually meant.
                        */}
                      <p className="h-day-meta h-day-facts">
                        {entry.recipe.time_minutes !== null && <span>{entry.recipe.time_minutes} min</span>}
                        {/* the cue for the title's other destination — said, not learned */}
                        {day.date === props.today && <span className="h-day-cook-cue">tap to cook</span>}
                        <Cooked
                          entryId={entry.id}
                          familyId={props.familyId}
                          recipeId={entry.recipe.id}
                          cookedAt={entry.cookedAt}
                          members={props.membersByRecipe[entry.recipe.id] ?? []}
                          parts={props.partsByRecipe[entry.recipe.id] ?? []}
                          disabled={busy !== null}
                          expanded={isOpen}
                          onCooked={(cooked) => setOpenEntry(cooked ? entry.id : null)}
                        />
                      </p>
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
                  {/*
                    * Everything you can *do* to the meal, absent until asked for — not shrunk.
                    * Shrinking was the wrong fix: four controls at 44px each do not fit beside a
                    * photograph on a phone at any size that is still tappable, so the answer is
                    * fewer controls at rest rather than smaller ones.
                    */}
                  {isOpen && (
                  <div className="h-day-panel" id={`entry-${entry.id}`} ref={panel}>
                    {/*
                      * The way to the recipe page, which the title used to be.
                      *
                      * Only *today's* title was repointed, so on six days in seven this is a
                      * second route to the same place — and it is here anyway, because the row is
                      * the disclosure and a reader should not have to know which day it is to
                      * find out where a tap goes.
                      */}
                    <Link className="h-chip" href={`/recipes/${entry.recipe.id}?planned=${entry.id}`}>
                      Open the recipe
                    </Link>
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
                      Take it off
                    </button>
                  </div>
                  )}
                </div>
                );
              })}
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
