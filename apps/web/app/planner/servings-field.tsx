"use client";

import { useEffect, useState } from "react";
import { MAX_SERVINGS, servingsForScale } from "@/lib/planner";

/**
 * How many people this is for.
 *
 * A person thinks "I need to feed six", not "1.5×". The stored value is still a multiplier — it
 * is what `packages/core` consolidates against — and this converts at the edge, which is where
 * the planner was already converting to *show* servings (decisions §41).
 *
 * A recipe that does not say what it yields cannot answer "feed six", so it gets a multiplier
 * instead rather than an invented yield of 1.
 */
export function ServingsField({
  entryId,
  scale,
  recipeServings,
  busy,
  onSave,
}: {
  entryId: string;
  scale: number;
  recipeServings: number | null;
  busy: boolean;
  onSave: (patch: { servings: number } | { scale: number }) => void;
}) {
  const asServings = servingsForScale(scale, recipeServings);
  const [value, setValue] = useState(String(asServings ?? scale));

  // the server is the authority: if it rounded, or another device changed it, follow
  useEffect(() => {
    setValue(String(servingsForScale(scale, recipeServings) ?? scale));
  }, [scale, recipeServings]);

  const commit = () => {
    if (recipeServings) {
      const servings = Number(value);
      if (!Number.isInteger(servings) || servings < 1 || servings > MAX_SERVINGS) {
        setValue(String(asServings ?? 1));
        return;
      }
      if (servings !== asServings) onSave({ servings });
      return;
    }
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0) {
      setValue(String(scale));
      return;
    }
    if (next !== scale) onSave({ scale: next });
  };

  return (
    <label className="servings">
      <input
        id={`servings-${entryId}`}
        type="number"
        inputMode="numeric"
        min={recipeServings ? 1 : undefined}
        max={recipeServings ? MAX_SERVINGS : undefined}
        step={recipeServings ? 1 : 0.5}
        value={value}
        disabled={busy}
        aria-label={recipeServings ? "Servings" : "Batch multiplier"}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <span className="meta">{recipeServings ? "servings" : "×"}</span>
    </label>
  );
}
