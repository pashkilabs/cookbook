import type { ReactNode } from "react";
import Link from "next/link";

/**
 * The three button shapes Harvest has (§3), and nothing else.
 *
 * **One primary action per screen.** Terracotta means "this is the thing"; a second one on the
 * same screen means neither is. Everything else is secondary or a plain control.
 *
 * Each comes in a **button form and a link form**, because the handoff's rule is real buttons and
 * real links rather than clickable divs — and because a server component cannot pass a handler to
 * a client component without a 500 (`check-client-props` exists for that). A navigation is a
 * `<Link>`, an action is a `<button>`, and picking the wrong one is what produces a control that
 * cannot be opened in a new tab or cannot be reached by keyboard.
 *
 * Sizes come from the tokens: 44px normally, 60px in cook mode, where a thumb is wet and the
 * phone is propped against a bag of flour.
 */
type Size = "normal" | "large";

interface Common {
  children: ReactNode;
  size?: Size;
  className?: string;
}

const classes = (base: string, size: Size | undefined, extra?: string) =>
  [base, size === "large" ? "is-large" : "", extra ?? ""].filter(Boolean).join(" ");

export function PrimaryButton({
  children,
  size,
  className,
  ...rest
}: Common & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button type="button" className={classes("h-primary", size, className)} {...rest}>
      {children}
    </button>
  );
}

export function PrimaryLink({ children, size, className, href, ...rest }: Common & { href: string }) {
  return (
    <Link href={href} className={classes("h-primary", size, className)} {...rest}>
      {children}
    </Link>
  );
}

export function SecondaryButton({
  children,
  size,
  className,
  ...rest
}: Common & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button type="button" className={classes("h-secondary", size, className)} {...rest}>
      {children}
    </button>
  );
}

export function SecondaryLink({ children, size, className, href, ...rest }: Common & { href: string }) {
  return (
    <Link href={href} className={classes("h-secondary", size, className)} {...rest}>
      {children}
    </Link>
  );
}

/**
 * A 44px circle holding one icon, and **`label` is required**.
 *
 * Not optional and not defaulted: an icon-only control with no accessible name is invisible to a
 * screen reader and ambiguous to everybody else. Making it a required prop means the compiler asks
 * rather than a review catching it.
 */
export function IconButton({
  label,
  children,
  className,
  ...rest
}: {
  label: string;
  children: ReactNode;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children" | "aria-label">) {
  return (
    <button type="button" aria-label={label} className={["h-icon", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
}

export function IconLink({
  label,
  children,
  href,
  className,
}: {
  label: string;
  children: ReactNode;
  href: string;
  className?: string;
}) {
  return (
    <Link href={href} aria-label={label} className={["h-icon", className].filter(Boolean).join(" ")}>
      {children}
    </Link>
  );
}
