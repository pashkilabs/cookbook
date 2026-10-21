import type { CSSProperties } from "react";
import { iconUrl } from "@/lib/chapters";

/**
 * A chapter's icon, masked rather than drawn.
 *
 * The PNG's alpha is the drawing and its RGB is bark, so an `<img>` would bake that ink in and
 * render at **1.01:1 on the dark surface** — invisible in cook mode and on /household's dark
 * theme, with every guard green because the element is there and the class is styled.
 * `check-chapter-icons.mjs` fails the build on an `<img>` reaching `public/chapters` for exactly
 * that reason.
 *
 * Decorative: the chapter name is always beside it, so this is `aria-hidden` with no `alt` and the
 * accessible name comes from the enclosing link. A screen reader hearing "Mains, 32" twice would
 * be worse served than one hearing it once.
 *
 * One 192px file per icon at every size — 4.2x at the smallest use, so the headroom is already
 * there and a second set would be a second thing to keep in step.
 */
export function ChapterIcon({ icon, size }: { icon: string; size: number }) {
  // a group with no drawing of its own ("Everything else") renders nothing rather than a blank box
  if (!icon) return null;
  return (
    <span
      className="h-chapter-icon"
      aria-hidden="true"
      style={
        {
          "--chapter-icon": iconUrl(icon),
          "--chapter-icon-size": `${size}px`,
        } as CSSProperties
      }
    />
  );
}
