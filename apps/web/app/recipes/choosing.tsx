"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LAYOUT_CHOICES, type RecipeLayout } from "@/lib/recipe-layout";

/**
 * The question, asked where the problem is visible.
 *
 * ---------------------------------------------------------------------------
 * Settings is where a choice goes to be never made
 * ---------------------------------------------------------------------------
 *
 * The same question lives on `/household`, and almost nobody will open it. So it is also asked
 * here, once, at the moment 67 recipes in one scroll are the thing on the screen — and
 * **dismissing it is free and permanent**, which is the only thing that makes asking in context
 * acceptable rather than a nag.
 *
 * "Not now" and "never asked" are different states and only one re-prompts. Both are written the
 * same way — `recipe_layout_asked_at` is stamped either way — so a dismissal is a real answer
 * rather than a deferral. The layout column is left alone by a dismissal, which is why the two are
 * separate columns (see `member_settings`).
 *
 * Both states are **per person** since §87: one member answering does not spend another member's
 * one question, so Paige is asked once even though Stephen has already chosen.
 *
 * The three deferred layouts are shown and **disabled with a reason**, not hidden. A household
 * choosing between two options does not know what it is not being offered, and "not built yet" is
 * a more honest screen than a shorter one — §83's lesson about absent-versus-too-few, applied to a
 * choice set.
 */
export function Choosing({ total }: { total: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  if (gone) return null;

  async function answer(layout: RecipeLayout | null) {
    setBusy(true);
    setError(null);
    // `finally` for the flag, `catch` for the message — one rejection, two consequences (§80)
    try {
      const response = await fetch("/api/household", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipeLayout: layout }),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        setError(failed.error ?? `that did not work (${response.status})`);
        return;
      }
      /*
       * Hidden immediately and then refreshed. The dismissal is already stored, so hiding first is
       * not optimism — it is not making somebody watch a round trip to put a card away.
       */
      setGone(true);
      router.refresh();
    } catch {
      setError("No signal — that was not saved. Try it again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="h-choosing-card">
      <h2 className="h-choosing-title">You have {total} recipes. How do you usually pick one?</h2>
      <p className="h-choosing-note">
        We&rsquo;ll lay this page out to match, for you — everybody here picks their own.
        Changeable any time in Household.
      </p>

      <div className="h-choosing-options">
        {LAYOUT_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className="h-choosing-option"
            disabled={busy || !choice.ready}
            // the reason a disabled option is disabled, said rather than implied
            title={choice.ready ? choice.description : "Not built yet — the data for it is not there"}
            onClick={() => void answer(choice.value)}
          >
            <span>{choice.label}</span>
            {!choice.ready && <span className="h-chip-quiet">not yet</span>}
          </button>
        ))}
      </div>

      <button type="button" className="h-choosing-dismiss" disabled={busy} onClick={() => void answer(null)}>
        Not now — I&rsquo;ll have a look around first
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
