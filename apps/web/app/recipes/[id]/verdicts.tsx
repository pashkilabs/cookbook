"use client";

import { useState } from "react";
import { browserClient } from "@/lib/supabase-browser";

/**
 * The two things this screen writes: who liked it, and whether to make it again.
 *
 * Both go through the person's own session, so RLS decides whether they land —
 * `household_can_write` is ANDed into every write policy, which means a household past its
 * grace window can read all of this and change none of it. That refusal arrives as an error
 * here rather than as silence, and it is shown.
 *
 * **Children are rated but never sign in** (the platform's central split), so the adult sets
 * every member's score, including their own. The five-point scale is the schema's — `CHECK
 * (score between 1 and 5)` — and the "whole family likes it" filter is what it exists for.
 */
export interface MemberVerdict {
  id: string;
  displayName: string;
  isChild: boolean;
  score: number | null;
}

const SCALE = [1, 2, 3, 4, 5] as const;

export function Verdicts(props: {
  recipeId: string;
  familyId: string;
  makeAgain: boolean | null;
  members: MemberVerdict[];
}) {
  const [members, setMembers] = useState(props.members);
  const [makeAgain, setMakeAgain] = useState(props.makeAgain);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function rate(memberId: string, score: number) {
    setBusy(memberId);
    setError(null);
    const supabase = browserClient();

    // Update-then-insert rather than upsert. `ratings_one_per_member` is a *partial* unique
    // index (`where deleted_at is null`), and PostgREST cannot name one as an ON CONFLICT
    // target — it has no way to restate the predicate. Two devices rating the same person in
    // the same instant can therefore both insert; the index refuses the second, which surfaces
    // as an error rather than a duplicate.
    const updated = await supabase
      .from("ratings")
      .update({ score, rated_at: new Date().toISOString() })
      .eq("recipe_id", props.recipeId)
      .eq("family_member_id", memberId)
      .is("deleted_at", null)
      .select("id");

    if (updated.error) {
      setError(refusal(updated.error));
      setBusy(null);
      return;
    }

    if (updated.data.length === 0) {
      const inserted = await supabase.from("ratings").insert({
        family_id: props.familyId,
        recipe_id: props.recipeId,
        family_member_id: memberId,
        score,
        rated_at: new Date().toISOString(),
      });
      if (inserted.error) {
        setError(refusal(inserted.error));
        setBusy(null);
        return;
      }
    }

    setMembers((current) =>
      current.map((member) => (member.id === memberId ? { ...member, score } : member)),
    );
    setBusy(null);
  }

  async function setVerdict(next: boolean | null) {
    setBusy("make-again");
    setError(null);
    const { error: failed } = await browserClient()
      .from("recipes")
      .update({ make_again: next })
      .eq("id", props.recipeId);
    if (failed) setError(refusal(failed));
    else setMakeAgain(next);
    setBusy(null);
  }

  return (
    <section>
      <h2>Who liked it</h2>
      <ul className="verdicts">
        {members.map((member) => (
          <li key={member.id}>
            <span className="who">
              {member.displayName}
              {member.isChild && <span className="meta"> · child</span>}
            </span>
            <span className="scale">
              {SCALE.map((score) => (
                <button
                  key={score}
                  type="button"
                  disabled={busy === member.id}
                  aria-pressed={member.score === score}
                  className={member.score === score ? "" : "quiet"}
                  onClick={() => rate(member.id, score)}
                >
                  {score}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>

      <h2 style={{ marginTop: "1.5rem" }}>Make it again?</h2>
      <div className="tabs">
        <button
          type="button"
          disabled={busy === "make-again"}
          className={makeAgain === true ? "" : "quiet"}
          onClick={() => setVerdict(makeAgain === true ? null : true)}
        >
          Yes
        </button>
        <button
          type="button"
          disabled={busy === "make-again"}
          className={makeAgain === false ? "" : "quiet"}
          onClick={() => setVerdict(makeAgain === false ? null : false)}
        >
          No
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </section>
  );
}

/**
 * `42501` is the entitlement predicate refusing a write, which is the read-only state after
 * grace — a household in it should be told why, not shown a database code.
 */
function refusal(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "This household is read-only — its subscription window has passed. Everything here is still readable.";
  }
  if (error.code === "23505") {
    return "Somebody else rated that at the same moment. Reload and try again.";
  }
  return error.message;
}
