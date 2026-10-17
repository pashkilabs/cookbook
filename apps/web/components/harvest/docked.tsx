import type { ReactNode } from "react";

/**
 * A docked bar at the bottom: secondary on the left, primary on the right (§3).
 *
 * **Docked, not floating.** The handoff forbids a floating CTA and §5 repeats it, and the reason
 * is not taste: a floating button covers content, and the content it covers on this app's screens
 * is an ingredient line or a shopping row — the thing somebody is reading. A docked bar takes its
 * own 84px and nothing is ever behind it.
 *
 * Which means the scrolling region must end above it. `.h-docked-page` is the pair: a column that
 * gives the bar its height and lets the content above scroll, so the last row can always be
 * reached. A docked bar without it hides the final item, which is the bug a floating bar has in a
 * different costume.
 */
export function DockedActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["h-docked", className].filter(Boolean).join(" ")}>{children}</div>;
}
