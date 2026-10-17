import type { ReactNode } from "react";

/**
 * A 42×52 pill: the day letter above the date (§3).
 *
 * Three states, and the dashed one is a *suggestion* rather than a selection — the same
 * distinction the checkbox draws, for the same reason. A solid terracotta fill is a decision the
 * household made; a dashed edge is the app offering, and §67 is explicit that a suggestion states
 * its reason and never pretends to be a verdict.
 *
 * The day letter is `aria-hidden` and the real date is in the accessible name, because "M" read
 * aloud before "19" is noise. One control, one name: "Monday 19, planned".
 */
export type DayState = "open" | "planned" | "suggested";

export function DayCircle({
  letter,
  date,
  state,
  name,
  onSelect,
  className,
}: {
  letter: string;
  date: ReactNode;
  state: DayState;
  /** the whole thing said once, for a screen reader: "Monday 19, planned" */
  name: string;
  onSelect?: () => void;
  className?: string;
}) {
  const shape = ["h-day", `is-${state}`, className].filter(Boolean).join(" ");
  if (!onSelect) {
    return (
      <span className={shape} role="img" aria-label={name}>
        <span aria-hidden="true">{letter}</span>
        <strong aria-hidden="true">{date}</strong>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={shape}
      aria-label={name}
      aria-pressed={state === "planned"}
      onClick={onSelect}
    >
      <span aria-hidden="true">{letter}</span>
      <strong aria-hidden="true">{date}</strong>
    </button>
  );
}
