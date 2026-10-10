"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Noting what somebody likes or dislikes, in the same breath as rating it.
 *
 * ---------------------------------------------------------------------------
 * Why it lives here and not on a settings screen
 * ---------------------------------------------------------------------------
 *
 * **A preference recorded at the moment an opinion exists is one that gets recorded.** The same
 * reasoning that put rating inline with "Cooked it": nobody navigates to a preferences page to
 * announce that Ada does not like mushrooms. They find it out at dinner, and the place to catch
 * it is the screen they are already on, a second after they gave the recipe a 2.
 *
 * This matters more than it looks. 26 ratings across 7 recipes, and the `cooked it` control that
 * would generate more has been live for weeks on a screen nobody has opened — so the learned
 * signal will stay thin regardless of what gets built (§71). Stated preferences are the mechanism
 * that makes month one work, and they only arrive if asking is free.
 *
 * ---------------------------------------------------------------------------
 * One control, not one per member
 * ---------------------------------------------------------------------------
 *
 * A select per person would be four selects on a four-person household, which is a form rather
 * than a note. One row — who, whether, what — is a sentence, and the subjects on offer are this
 * recipe's own: its cuisine, its dish form, and the things in it. Nothing invites a preference
 * about an ingredient that is not in front of you.
 *
 * What is already stated is listed below it, with a way to withdraw, because an inference nobody
 * can correct goes wrong permanently and a *statement* nobody can withdraw is worse.
 */
export interface PreferenceMember {
  id: string;
  displayName: string;
}

export interface StatedSoFar {
  id: string;
  memberId: string;
  memberName: string;
  stance: "like" | "dislike";
  subject: string;
  subjectKind: string;
}

export function Preferences({
  members,
  subjects,
  stated,
}: {
  members: PreferenceMember[];
  /** this recipe's own subjects, so nothing invites an opinion about something absent */
  subjects: Array<{ kind: string; value: string; label: string }>;
  stated: StatedSoFar[];
}) {
  const router = useRouter();
  /*
   * Who is **derived** from who has not spoken yet, with an explicit override.
   *
   * It used to be plain state initialised to `members[0]`, and that is the best explanation for
   * the report that a second member could not state theirs. The dropdown does not advance, so
   * after Ada says she likes something, clicking the other stance states it *for Ada again* —
   * and the route finds her existing row and flips it. One statement, not two, and the subject
   * looks spent.
   *
   * Nobody is at fault for that: the control invited a second opinion and then silently applied
   * it to the first person. Deriving the default means the obvious next action is the right one,
   * and `chosen` keeps a deliberate choice from being overruled.
   */
  const [chosen, setChosen] = useState<string | null>(null);
  const [what, setWhat] = useState(subjects[0] ? `${subjects[0].kind}:${subjects[0].value}` : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (members.length === 0 || subjects.length === 0) return null;

  /*
   * One entry per subject, each naming everyone who has spoken about it. Insertion-ordered by
   * first mention so the list does not reshuffle when somebody adds an opinion.
   */
  /*
   * The members who have not spoken about the subject currently selected — so the default is
   * always somebody whose opinion would be *new*. Falls back to the whole roster once everybody
   * has spoken, because changing your mind has to stay possible.
   */
  const selectedSubject = what.slice(what.indexOf(":") + 1);
  const silent = members.filter(
    (member) => !stated.some((entry) => entry.memberId === member.id && entry.subject === selectedSubject),
  );
  const who = chosen ?? silent[0]?.id ?? members[0]?.id ?? "";

  const bySubject = new Map<string, StatedSoFar[]>();
  for (const entry of stated) {
    const list = bySubject.get(entry.subject);
    if (list) list.push(entry);
    else bySubject.set(entry.subject, [entry]);
  }
  const grouped = [...bySubject.entries()];

  async function state(stance: "like" | "dislike") {
    if (busy || !who || !what) return;
    setBusy(true);
    setError(null);
    const [kind, ...rest] = what.split(":");
    // `finally`: an offline fetch rejects, and every control here is gated on this flag
    try {
      const response = await fetch("/api/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familyMemberId: who,
          stance,
          subjectKind: kind,
          subject: rest.join(":"),
        }),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        setError(failed.error ?? `that did not save (${response.status})`);
        return;
      }
      // cleared so the next default is recomputed from who has now spoken — which is what makes
      // the obvious second action belong to the second person
      setChosen(null);
      router.refresh();
    } catch {
      setError("No signal — that was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/preferences?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(`that did not withdraw (${response.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("No signal — that was not withdrawn.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      <p className="meta">
        Was it something in particular?
        {silent.length === 0 && members.length > 1 && (
          <> Everyone has said something about this one — choosing again changes their mind.</>
        )}
      </p>
      <div className="tabs" style={{ margin: 0, flexWrap: "wrap", alignItems: "center" }}>
        <select value={who} onChange={(event) => setChosen(event.target.value)} disabled={busy}>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
        <select
          value={what}
          // changing the subject clears the override: the default should follow the new subject's
          // own silence rather than keeping a person picked for a different one
          onChange={(event) => { setWhat(event.target.value); setChosen(null); }}
          disabled={busy}
        >
          {subjects.map((subject) => (
            <option key={`${subject.kind}:${subject.value}`} value={`${subject.kind}:${subject.value}`}>
              {subject.label}
            </option>
          ))}
        </select>
        <button type="button" className="button quiet" disabled={busy} onClick={() => state("like")}>
          likes it
        </button>
        <button type="button" className="button quiet" disabled={busy} onClick={() => state("dislike")}>
          doesn&rsquo;t like it
        </button>
      </div>

      {/*
        * Grouped by subject, because two members disagreeing is the NORMAL case — it is the whole
        * reason preferences are per member. One line per statement made "Ada likes rice noodles"
        * and "Paige doesn't like rice noodles" two unrelated facts; grouped, they read as the
        * sentence they are: *rice noodles — Ada likes it, Paige does not.*
        *
        * The subject stays in the select whatever has been said about it. A third member has to
        * be able to speak, and an option that vanishes once somebody has an opinion is a dead end.
        */}
      {grouped.length > 0 && (
        <ul className="ingredients" style={{ marginTop: "0.6rem" }}>
          {grouped.map(([subject, entries]) => (
            <li key={subject}>
              <span>
                <strong>{subject}</strong>
                {" — "}
                {entries.map((entry, at) => (
                  <span key={entry.id}>
                    {at > 0 ? ", " : ""}
                    {entry.memberName} {entry.stance === "like" ? "likes it" : "does not"}
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy}
                      aria-label={`withdraw ${entry.memberName}'s opinion of ${subject}`}
                      onClick={() => withdraw(entry.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {entries.length > 1 && entries.some((e) => e.stance === "like") && entries.some((e) => e.stance === "dislike") && (
                  <span className="meta"> · a disagreement, which the suggestions will say out loud rather than average away</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
