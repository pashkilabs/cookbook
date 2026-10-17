"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";
import { refusal } from "@/lib/refusal";

/**
 * "We cooked this" — and, in the same breath, what everyone thought.
 *
 * ---------------------------------------------------------------------------
 * Why it lives on the planner and not on the recipe
 * ---------------------------------------------------------------------------
 *
 * The moment a household knows a meal was cooked is the evening it was cooked, and the screen
 * they are looking at then is the week. Putting this on the recipe page would require somebody
 * to remember, later, to open a recipe they have already eaten — and the production numbers say
 * exactly how well that works: **twenty-eight meals planned across five weeks, two ratings.**
 * Not because nobody had an opinion, but because the opinion and the errand were separated.
 *
 * So it sits on the day, in the plan, next to the meal it is about.
 *
 * ---------------------------------------------------------------------------
 * The rating is not a second errand
 * ---------------------------------------------------------------------------
 *
 * Marking cooked opens the scores inline rather than linking away. A rating is worth having at
 * the table and worthless a week later, and every screen between the two is somewhere to give
 * up. Nothing is required: the meal is recorded whether or not anybody scores it, because the
 * count must not depend on the household having an opinion.
 *
 * **Children are rated but never sign in**, so an adult sets every member's score including
 * their own — the same split `verdicts.tsx` uses, and the same update-then-insert, because
 * `ratings_one_per_member` is a partial unique index PostgREST cannot name as a conflict target.
 */
export interface CookMember {
  id: string;
  displayName: string;
  score: number | null;
}

export function Cooked({
  entryId,
  familyId,
  recipeId,
  cookedAt,
  members,
  parts,
  disabled,
  expanded = false,
  onCooked,
}: {
  entryId: string;
  familyId: string;
  recipeId: string;
  cookedAt: string | null;
  members: CookMember[];
  /** the recipe's components, so a surplus can be kept against the part it is */
  parts: string[];
  disabled: boolean;
  /**
   * Whether the row holding this is open.
   *
   * The **mark** is always visible and the **scores** are not. Moving the mark behind a tap is
   * what cost two ratings against twenty-eight planned dinners the last time it lived away from
   * the day: the moment a household knows something was cooked is the evening it was cooked, and
   * this is the screen they are looking at then. The score grid is five buttons per member and is
   * what crushed the row, so that half waits to be asked for — and it always did, behind "Who
   * liked it?", so nothing has moved further away than it already was.
   */
  expanded?: boolean;
  /**
   * Marking a meal cooked asks the row to open, so the scores are in front of somebody at the one
   * moment rating is cheapest. That behaviour was `setOpen(cooked)` before the row owned the
   * disclosure, and losing it in the refactor would have quietly undone the thing the 2-ratings-
   * against-28-dinners measurement bought.
   */
  onCooked?: (cooked: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, number | null>>(
    Object.fromEntries(members.map((m) => [m.id, m.score])),
  );

  const setCooked = async (cooked: boolean) => {
    setBusy(true);
    setError(null);

    // `finally`: an offline fetch rejects, so a reset after the await never runs and every
    // control gated on this flag stays dead (scripts/check-busy-guarded.mjs)
    try {
      const response = await fetch(`/api/plan-entries/${entryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cooked }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `that did not work (${response.status})`);
        return;
      }
      // opened on marking, closed on unmarking: the scores are about a meal that happened
      onCooked?.(cooked);
      router.refresh();
    } catch {
      // an offline fetch REJECTS rather than returning: without this the person sees
      // nothing at all and the promise rejects unhandled. `finally` protected the busy
      // flag and nothing protected the message.
      setError("No signal — that was not saved. Try it again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const rate = async (memberId: string, score: number) => {
    setBusy(true);
    setError(null);

    // `finally`: a rejected request — offline, or a refused write — must not leave the
    // flag set, because every control here is gated on it (scripts/check-busy-guarded.mjs)
    try {
      const supabase = browserClient();
      const stamp = new Date().toISOString();

      // update-then-insert, not upsert: `ratings_one_per_member` is a partial unique index and
      // PostgREST cannot restate its predicate as an ON CONFLICT target (verdicts.tsx)
      const updated = await supabase
        .from("ratings")
        .update({ score, rated_at: stamp })
        .eq("recipe_id", recipeId)
        .eq("family_member_id", memberId)
        .is("deleted_at", null)
        .select("id");
      if (updated.error) {
        setError(refusal(updated.error));
        return;
      }
      if (updated.data.length === 0) {
        const inserted = await supabase.from("ratings").insert({
          family_id: familyId,
          recipe_id: recipeId,
          family_member_id: memberId,
          score,
          rated_at: stamp,
        });
        if (inserted.error) {
          setError(refusal(inserted.error));
          return;
        }
      }
      setScores((current) => ({ ...current, [memberId]: score }));
    } catch {
      /*
       * postgrest-js converts a failed fetch into `{ error }` rather than rejecting, so this is
       * belt and braces — and it is here because *verifying* that is a claim about a dependency's
       * internals, where a `catch` is three lines and never wrong.
       */
      setError("No signal — that score was not saved. Try it again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  /*
   * "Made extra" — the base, recorded at the only moment it is true.
   *
   * A base is a pantry item that remembers which part of which recipe it is, so the lines it
   * covers are looked up rather than matched by name (§69). Offered here because the evening you
   * cooked a double batch is the only evening you know you did.
   */
  const keep = async (part: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pantry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: part, fromRecipeId: recipeId, fromComponent: part, batches: 1 }),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        setError(failed.error ?? `that did not work (${response.status})`);
        return;
      }
      setKept((current) => [...current, part]);
      router.refresh();
    } catch {
      setError("No signal — that was not saved.");
    } finally {
      setBusy(false);
    }
  };

  /*
   * The mark, and it is the same control in both states rather than two different ones — a tick
   * that fills. Two buttons swapping places under a thumb is how somebody taps "undo" meaning
   * "cooked it".
   */
  const mark = (
    <button
      type="button"
      className={cookedAt ? "h-cooked-mark is-on" : "h-cooked-mark"}
      disabled={disabled || busy}
      aria-pressed={Boolean(cookedAt)}
      title={cookedAt ? "This was not cooked after all" : "Record that this was cooked"}
      onClick={() => setCooked(!cookedAt)}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12l5 5 9-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {busy ? "…" : cookedAt ? "Cooked" : "Cooked it"}
    </button>
  );

  if (!cookedAt) {
    return (
      <>
        {mark}
        {error && <p className="h-day-meta">{error}</p>}
      </>
    );
  }

  if (!expanded) {
    /*
     * Closed and cooked: the mark, plus a quiet note when somebody still has no score. The prompt
     * is kept rather than dropped — it is the only thing that turns a cooked meal into a rating —
     * but it points at the row's own disclosure instead of opening a grid in place.
     */
    return (
      <>
        {mark}
        {members.some((m) => scores[m.id] == null) && (
          <span className="h-day-meta">· who liked it?</span>
        )}
        {error && <p className="h-day-meta">{error}</p>}
      </>
    );
  }

  return (
    <div className="h-cooked-panel">
      {mark}

      {/* the grid, which is what crushed the row — five buttons per member */}
      {(
        <div className="h-scores">
          {/*
            * The name ABOVE its scores, not beside them, and the arithmetic decides it.
            *
            * Inside a day row on a 390px phone there are **270px**: the viewport less the week's
            * 20px gutters, the row's 12px padding and the 44px date block with its gap. A name
            * column at 5rem plus five 44px buttons and their gaps needs **340px**, so the "5"
            * was cut off on every row — and no size makes five targets both tappable and visible
            * beside a name. Same constraint as the row at rest: fewer things per line, not
            * smaller ones.
            *
            * With the name on its own line the buttons share what is left — 47.6px each here,
            * 33.6px at 320px — and because they flex rather than sit at a fixed width they
            * **cannot overflow at any viewport**. That is the part that matters: the old row did
            * not merely look tight, it made the page wider than the screen.
            */}
          {members.map((member) => (
            <div key={member.id} className="h-score-row">
              <span className="h-score-who">{member.displayName}</span>
              <div className="h-score-buttons">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    className={scores[member.id] === score ? "h-score is-on" : "h-score"}
                    disabled={busy}
                    aria-label={`${member.displayName}: ${score} of 5`}
                    onClick={() => rate(member.id, score)}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="h-day-meta">Nothing here is required — the meal is recorded either way.</p>
        </div>
      )}
      {parts.length > 0 && (
        <div className="h-scores">
          <p className="h-day-meta">Made extra of a part? Keep it for next time:</p>
          <div className="h-keep-parts">
            {parts.map((part) => (
              <button
                key={part}
                type="button"
                className={kept.includes(part) ? "h-chip is-on" : "h-chip"}
                disabled={busy || kept.includes(part)}
                onClick={() => keep(part)}
              >
                {kept.includes(part) ? `${part} — kept` : `made extra ${part}`}
              </button>
            ))}
          </div>
          {/*
            * The honest sentence, on the screen rather than in a comment.
            *
            * A feature sold as "cook faster later" that cannot skip a step has to say which half
            * it delivers, in the same breath, or the first use teaches it instead. §68's chain
            * still binds: components index the ingredient list and the inference never sees the
            * method, so the app does not know which steps make this part.
            */}
          <p className="h-day-meta">
            Next time this is planned it comes off your shopping list. The app does not know
            which steps make it, so you will still need to find that in the method yourself —
            the saving is the shopping, not the cooking.
          </p>
        </div>
      )}

      {error && <p className="h-day-meta">{error}</p>}
    </div>
  );
}
