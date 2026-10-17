import type { ReactNode } from "react";

/**
 * A chip states a fact; it is never a control (§3).
 *
 * Three variants and each means something:
 *
 *   sage      a tag or a time — what the recipe *is*
 *   clay      planned, tonight, a per-day split — what the *week* says about it
 *   turmeric  "New", and only that. Always dark text: §2 forbids white on turmeric and on sage,
 *             and the token pair is the enforcement rather than a note somebody reads.
 *
 * Rendered as a `<span>` on purpose. A chip that looked tappable and was not is worse than one
 * that looks like what it is — and where a chip *does* need to act, that is a Chip inside a
 * button, which keeps the two roles separable.
 */
export type ChipTone = "sage" | "clay" | "turmeric";

export function Chip({
  tone = "sage",
  children,
  className,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={["h-chip", `is-${tone}`, className].filter(Boolean).join(" ")}>{children}</span>;
}
