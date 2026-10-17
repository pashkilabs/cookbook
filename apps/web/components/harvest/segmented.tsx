"use client";

import type { ReactNode } from "react";

/**
 * A segmented control: a sunken track, one selected segment raised (§3).
 *
 * `aria-pressed` on each button rather than a radiogroup, which is what the reference wireframes
 * use and what a screen reader reads most plainly for a two-to-four-way display switch. The
 * selected segment is parchment at 700 weight with the one shadow Harvest owns; the rest are loam
 * at 600, so the difference is weight and ground rather than colour alone.
 *
 * **Every segment is 44px of touch target** even though the visible pill is 38px: the track's 3px
 * padding plus the button's own height clears the minimum, and a control this small is the one
 * people miss in a kitchen.
 */
export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  className,
}: {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (next: T) => void;
  /** names the group for a screen reader — what is being switched, not which option is on */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={["h-segmented", className].filter(Boolean).join(" ")}
    >
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          aria-pressed={segment.value === value}
          className={segment.value === value ? "is-selected" : ""}
          onClick={() => onChange(segment.value)}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
