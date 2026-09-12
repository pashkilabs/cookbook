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
  disabled,
}: {
  entryId: string;
  familyId: string;
  recipeId: string;
  cookedAt: string | null;
  members: CookMember[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<Record<string, number | null>>(
    Object.fromEntries(members.map((m) => [m.id, m.score])),
  );

  const setCooked = async (cooked: boolean) => {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/plan-entries/${entryId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cooked }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? `that did not work (${response.status})`);
      return;
    }
    // opened on marking, closed on unmarking: the scores are about a meal that happened
    setOpen(cooked);
    router.refresh();
  };

  const rate = async (memberId: string, score: number) => {
    setBusy(true);
    setError(null);
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
      setBusy(false);
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
        setBusy(false);
        return;
      }
    }
    setScores((current) => ({ ...current, [memberId]: score }));
    setBusy(false);
  };

  if (!cookedAt) {
    return (
      <div>
        <button
          type="button"
          className="quiet"
          disabled={disabled || busy}
          title="Record that this was cooked"
          onClick={() => setCooked(true)}
        >
          {busy ? "…" : "Cooked it"}
        </button>
        {error && <p className="meta">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <span className="meta">
        Cooked{" "}
        <button
          type="button"
          className="quiet"
          disabled={disabled || busy}
          title="This was not cooked after all"
          onClick={() => setCooked(false)}
        >
          undo
        </button>
      </span>

      {!open && members.some((m) => scores[m.id] == null) && (
        <button type="button" className="quiet" disabled={busy} onClick={() => setOpen(true)}>
          Who liked it?
        </button>
      )}

      {open && (
        <div>
          {members.map((member) => (
            <div key={member.id} style={{ display: "flex", gap: "var(--s2)", alignItems: "baseline" }}>
              <span className="meta" style={{ minWidth: "5rem" }}>{member.displayName}</span>
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  type="button"
                  className={scores[member.id] === score ? "button" : "quiet"}
                  disabled={busy}
                  aria-label={`${member.displayName}: ${score} of 5`}
                  onClick={() => rate(member.id, score)}
                >
                  {score}
                </button>
              ))}
            </div>
          ))}
          <p className="meta">
            Nothing here is required — the meal is recorded either way.
          </p>
        </div>
      )}
      {error && <p className="meta">{error}</p>}
    </div>
  );
}
