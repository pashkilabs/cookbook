"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * What this household avoids.
 *
 * A household setting beside units and timezone, and for a reason worth stating: **you do not
 * cook two dinners.** The exclusion was always household-wide in effect, so putting it on a
 * person would have stored something far more sensitive to produce an identical answer (§71).
 *
 * **The honest sentence is on the control, not in a dialog.** A warning somebody dismisses once
 * is a warning that was never read, and the limit here is permanent rather than incidental: an
 * ingredient list names what is *added*, not what is inside what is added. So the wording says
 * what this does — hides recipes with the ingredient written in them — and what it cannot do, in
 * the same breath, where somebody deciding whether to rely on it is actually looking.
 */
const ALLERGENS = [
  { value: "peanut", label: "Peanuts" },
  { value: "tree-nut", label: "Tree nuts" },
  { value: "milk", label: "Milk & dairy" },
  { value: "egg", label: "Eggs" },
  { value: "fish", label: "Fish" },
  { value: "shellfish", label: "Shellfish" },
  { value: "soy", label: "Soy" },
  { value: "wheat", label: "Wheat & gluten" },
  { value: "sesame", label: "Sesame" },
] as const;

export function AllergenSetting({ current }: { current: string[] }) {
  const [chosen, setChosen] = useState<string[]>(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function toggle(allergen: string) {
    if (pending) return;
    const previous = chosen;
    const next = chosen.includes(allergen)
      ? chosen.filter((value) => value !== allergen)
      : [...chosen, allergen].sort();
    setChosen(next);
    setError(null);

    try {
      const response = await fetch("/api/household", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avoidedAllergens: next }),
      });
      if (!response.ok) {
        // put it back rather than leaving the screen claiming something the database does not say
        setChosen(previous);
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That did not save.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setChosen(previous);
      setError("No signal — that was not saved.");
    }
  }

  return (
    <div className="allergens" style={{ marginTop: "1rem" }}>
      <div className="tabs" style={{ margin: 0, flexWrap: "wrap" }}>
        {ALLERGENS.map((allergen) => (
          <button
            key={allergen.value}
            type="button"
            className={`button${chosen.includes(allergen.value) ? " selected" : " quiet"}`}
            aria-pressed={chosen.includes(allergen.value)}
            disabled={pending}
            onClick={() => void toggle(allergen.value)}
          >
            {allergen.label}
          </button>
        ))}
      </div>

      {/*
        * Two sentences, and neither is optional.
        *
        * The first says what it does in terms a person can check: it reads the words in the
        * ingredient list. The second says what it cannot do, with an example, because "may
        * contain" is abstract and "the fish sauce in a jar of curry paste" is not.
        *
        * The word "safe" does not appear, and the strongest claim available is "nothing we could
        * see" (§71). A feature that implies safety it cannot deliver is worse than no feature.
        */}
      <p className="meta" style={{ marginTop: "0.6rem" }}>
        {chosen.length === 0
          ? "Nothing is being avoided. Choosing one hides recipes that write that ingredient in their list."
          : "Recipes that write one of these in their ingredient list are hidden from suggestions, and flagged if you open them directly."}
      </p>
      <p className="meta">
        <strong>It reads ingredient lists, so it cannot see inside a jar.</strong> A curry paste
        may contain fish sauce, a pesto may contain pine nuts, a brioche bun may contain milk —
        and a recipe only names the jar. Where something bought ready-made could carry one of
        these, the recipe is shown with the product named rather than hidden, so you can check the
        label. This reduces what you have to read; it is not a substitute for reading it.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
