"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LAYOUT_CHOICES, type RecipeLayout } from "@/lib/recipe-layout";

/**
 * How this household decides what to cook — the setting, beside units and timezone.
 *
 * Asked as a **question about the household**, never as a list of layouts. The answer is a
 * declared fact, which §71 established beats an inferred one: a household that says "it depends
 * how much time we've got" has told us something no amount of behaviour would establish, and told
 * us on purpose.
 *
 * The three that are not built are shown and disabled with a reason rather than hidden, for the
 * same reason the in-context card does it: a household choosing between two options cannot see
 * what it is not being offered, and "not built yet" is a more honest screen than a shorter one.
 */
export function ChoosingSetting({ current }: { current: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function choose(layout: RecipeLayout) {
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
      setSaved(layout);
      router.refresh();
    } catch {
      setError("No signal — that was not saved. Try it again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const chosen = saved ?? current;

  return (
    <section className="h-setting">
      <h2 className="h-setting-title">How do you usually decide what to cook?</h2>
      <p className="h-setting-note">
        This sets how your recipes are laid out. Change it whenever you like — nothing is lost
        either way.
      </p>

      <div className="h-choosing-options">
        {LAYOUT_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={chosen === choice.value ? "h-choosing-option is-on" : "h-choosing-option"}
            // a radio group's semantics without a radio group's markup: one of a set, and which
            aria-pressed={chosen === choice.value}
            disabled={busy || !choice.ready}
            onClick={() => void choose(choice.value)}
          >
            <span>
              <strong>{choice.label}</strong>
              <span className="h-layout-count">{choice.description}</span>
            </span>
            {!choice.ready && <span className="h-chip-quiet">not yet</span>}
          </button>
        ))}
      </div>

      {/*
        * The sentence that keeps the setting honest. Search and an A–Z list are on every layout,
        * never one of them — making "knowing the name" a mode would hide it from four households
        * in five, which is why the Index idea was dropped as an option and kept as a feature.
        */}
      <p className="h-setting-note">
        Search is on every one of these. Knowing the name is a different job from choosing.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
