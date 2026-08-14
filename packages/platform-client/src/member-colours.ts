/**
 * The colours a household can give its members.
 *
 * **A key is stored, not a hex value.** `family_members.colour` holds `"clay"`, and the app
 * decides what clay looks like — so a restyle is a stylesheet change rather than a data
 * migration, and every app in the portfolio inherits one vocabulary instead of each inventing
 * its own palette. The same reasoning as the catalog: the seam owns the words, the app owns the
 * appearance.
 *
 * Validated on write, because a platform table with an open text column ends up holding
 * `#ff00ff`, `red`, and `rgb(1,2,3)` within a year.
 *
 * **Eight, and distinguishable at the size of a rating dot.** A household of five needs five that
 * cannot be mistaken for one another across a kitchen. Deuteranopia makes clay and olive a harder
 * pair than they look here, which is why the interface never uses colour alone — every member's
 * name sits beside their dot, and the colour is recognition rather than identification.
 */
export interface MemberColour {
  key: string;
  label: string;
  /** a reference value for anything that cannot read the stylesheet; the app owns the real one */
  hex: string;
}

export const MEMBER_COLOURS: readonly MemberColour[] = [
  { key: "clay", label: "Clay", hex: "#b4531f" },
  { key: "olive", label: "Olive", hex: "#6b7a3a" },
  { key: "teal", label: "Teal", hex: "#2f7d78" },
  { key: "plum", label: "Plum", hex: "#7d3f6a" },
  { key: "indigo", label: "Indigo", hex: "#40518f" },
  { key: "mustard", label: "Mustard", hex: "#a87a12" },
  { key: "rose", label: "Rose", hex: "#b04a5f" },
  { key: "slate", label: "Slate", hex: "#55606b" },
] as const;

export const isMemberColour = (value: unknown): value is string =>
  typeof value === "string" && MEMBER_COLOURS.some((colour) => colour.key === value);

/**
 * The next colour that nobody in the household is using.
 *
 * So adding a child is one field — a name — rather than two. Falls back to cycling once every
 * colour is taken, because eight is a lot of children and a repeat is better than a refusal.
 */
export function nextFreeColour(taken: ReadonlyArray<string | null>): string {
  const used = new Set(taken.filter((colour): colour is string => typeof colour === "string"));
  const free = MEMBER_COLOURS.find((colour) => !used.has(colour.key));
  return (free ?? MEMBER_COLOURS[used.size % MEMBER_COLOURS.length]!).key;
}
