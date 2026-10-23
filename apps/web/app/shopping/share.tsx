"use client";

import { useState } from "react";
import { SecondaryButton } from "@/components/harvest";

/**
 * The share button §4.5 asks for — and it only appears when there is somewhere for it to go.
 *
 * `navigator.share` is a phone API; `navigator.clipboard` covers a desktop. Where neither exists
 * the button does not render, for the reason cook mode's "Screen on" badge does not render
 * without a lock: a control that cannot do the thing it names is worse than a missing one,
 * because the person taps it and learns nothing.
 *
 * `useState(() => …)` rather than an effect: this is a client component, so the first render is
 * already in the browser, and an effect would flash the button in and out.
 */
export function ShareList({ text }: { text: string }) {
  const [how] = useState<"share" | "copy" | null>(() => {
    if (typeof navigator === "undefined") return null;
    if (typeof navigator.share === "function") return "share";
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") return "copy";
    return null;
  });
  const [said, setSaid] = useState<string | null>(null);

  if (how === null) return null;

  /*
   * `SecondaryButton` rather than `IconButton`, and a **visible label**.
   *
   * It was a bare 44px circle holding one unlabelled glyph, and it is the only route to sharing
   * the list — so it read as decoration and was taken for an upload control. An icon-only button
   * is defensible for a chevron everybody already knows; it is not defensible for the single way
   * out of a screen.
   *
   * So not `IconButton`, which is a circle for icon-only controls: once there is a word beside the
   * icon the right primitive is the one with a gap and room for text. `IconButton` is correct and
   * still has **zero adopters** — defined, exported, and hand-rolled around by two screens
   * instead, which is the same shape as `SegmentedControl` and `units.tsx`.
   *
   * The glyph is unchanged and was never wrong: a straight arrow rising out of an open tray is
   * the mark iOS uses. It looked wrong because it rendered **7px wide** — the bare `button`
   * selector's padding crushing it inside the circle (see `.h-icon`). At 24px beside a word it
   * reads as what it is.
   */
  return (
    <SecondaryButton
      aria-label={how === "share" ? "Share this list" : "Copy this list"}
      onClick={async () => {
        try {
          if (how === "share") await navigator.share({ title: "Shopping list", text });
          else {
            await navigator.clipboard.writeText(text);
            setSaid("Copied");
            window.setTimeout(() => setSaid(null), 2000);
          }
        } catch {
          // a cancelled share sheet rejects, and cancelling is not a failure worth a message
        }
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 16V4m0 0L8 8m4-4l4 4M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* the word, which is the point: "Copied" replaces it in place rather than hiding the icon */}
      {said ?? (how === "share" ? "Share" : "Copy")}
    </SecondaryButton>
  );
}
