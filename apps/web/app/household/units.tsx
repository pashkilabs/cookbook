"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/harvest";

/**
 * Which units the household reads.
 *
 * A household setting, not a personal one: the document it governs is the shopping list, and two
 * people standing in the same shop reading different units off the same list is exactly what this
 * prevents (decisions §28).
 *
 * It changes **display only**. Amounts are stored as the recipe wrote them and converted on the
 * way out (§47), so switching this back and forth is free and loses nothing — which is worth
 * saying on the screen, because a setting that might rewrite your recipes is one nobody touches.
 */
const OPTIONS = [
  { value: "us", label: "US", example: "2½ lb potatoes · 1 pint cream" },
  { value: "metric", label: "Metric", example: "1.2 kg potatoes · 600 ml cream" },
] as const;

export function UnitsSetting({ current }: { current: "us" | "metric" }) {
  const [system, setSystem] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function choose(next: "us" | "metric") {
    if (next === system || pending) return;
    const previous = system;
    setSystem(next);
    setError(null);

    try {
      const response = await fetch("/api/household", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ measurementSystem: next }),
      });

      if (!response.ok) {
        // put it back rather than leaving the screen claiming something the database does not say
        setSystem(previous);
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That did not save.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      // an offline fetch rejects; without this the chip shows the new units and the database
      // never heard, which is the screen claiming something that is not true
      setSystem(previous);
      setError("No signal — that was not saved.");
    }
  }

  /*
   * `SegmentedControl`, not a hand-rolled row of buttons.
   *
   * This was `className={`button${selected ? " selected" : ""}`}` inside `.tabs`, and **`.selected`
   * is defined in no stylesheet** — the Harvest redesign named it `.h-segmented button.is-selected`
   * and this control was never migrated. So the class was applied, nothing styled it, and both
   * segments fell through to the bare `button` element selector, which fills with `--primary`:
   * **US and Metric both rendered as filled terracotta, in both themes, on every screenshot.**
   *
   * The allergen chips below survived the same missing class by accident, because their
   * *unselected* branch says `" quiet"` and `button.quiet` does exist. One missing class, a
   * correct-looking control in one place and a broken one here — which is why nobody reported it
   * and why the difference is worth stating rather than fixing quietly.
   *
   * `disabled` while pending is dropped rather than reimplemented: the primitive owns the
   * control's markup, `choose` already returns early on `pending`, and a second disabled
   * mechanism inside a shared primitive would be a second site for its behaviour.
   */
  return (
    <div className="units">
      <SegmentedControl
        segments={OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        value={system}
        onChange={(next) => void choose(next)}
        label="Which units this household reads"
      />
      <p className="meta" style={{ marginTop: "0.5rem" }}>
        {OPTIONS.find((option) => option.value === system)?.example}
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
