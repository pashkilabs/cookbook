import type { ReactNode } from "react";

/**
 * Three states, and they must look clearly different (§3).
 *
 *   need           empty, 2px outline — buy it
 *   have           olive fill, white check, row struck through and muted — done
 *   check-pantry   dashed outline — you may already own this, look before you go
 *
 * The third is the one that matters and the reason this is not a plain checkbox. A dashed edge
 * says *unresolved* rather than *unchecked*, which is exactly what a pantry item with no recorded
 * amount is: the shopping list cannot know whether to buy it, and §73 settled that such a line is
 * withheld **and named** rather than silently decided either way. The shape carries that meaning.
 *
 * **A real `<input type="checkbox">` underneath**, visually hidden and still focusable, because a
 * styled `<span>` is not operable by keyboard and not announced as checkable. The box people see
 * is decoration over a control that works.
 */
export type CheckState = "need" | "have" | "check-pantry";

export function Checkbox({
  state,
  onToggle,
  label,
  children,
  className,
}: {
  state: CheckState;
  onToggle?: () => void;
  /** the accessible name, when the visible children are not plain text */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={["h-check", `is-${state}`, className].filter(Boolean).join(" ")}>
      <input
        type="checkbox"
        checked={state === "have"}
        onChange={onToggle}
        aria-label={label}
        disabled={!onToggle}
      />
      <span className="h-check-box" aria-hidden="true">
        {state === "have" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
      </span>
      <span className="h-check-body">{children}</span>
    </label>
  );
}
