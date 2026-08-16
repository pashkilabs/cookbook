"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
  }

  return (
    <div className="units">
      <div className="tabs" style={{ margin: 0 }}>
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`button${system === option.value ? " selected" : ""}`}
            aria-pressed={system === option.value}
            disabled={pending}
            onClick={() => void choose(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="meta" style={{ marginTop: "0.5rem" }}>
        {OPTIONS.find((option) => option.value === system)?.example}
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
