import type { ReactNode } from "react";

/**
 * A section heading, optionally with one action beside it (§3).
 *
 * `level` because a heading's rank is structure, not size: a screen has one `h1` and the sections
 * under it are `h2`, whatever they look like. Getting that wrong gives a screen reader a document
 * outline that does not match the page.
 *
 * `eyebrow` is the other kind — the small uppercase label over a group, like an aisle name on the
 * shopping list. It is not a heading at all and must not be rendered as one: it labels a run of
 * rows rather than opening a section, so it gets `role="presentation"` styling and the list it
 * labels carries the accessible name.
 */
export function SectionHeader({
  children,
  level = 2,
  action,
  className,
}: {
  children: ReactNode;
  level?: 1 | 2 | 3;
  action?: ReactNode;
  className?: string;
}) {
  const Heading = `h${level}` as "h1" | "h2" | "h3";
  return (
    <div className={["h-section", className].filter(Boolean).join(" ")}>
      <Heading>{children}</Heading>
      {action}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["h-eyebrow", className].filter(Boolean).join(" ")}>{children}</div>;
}
