/**
 * The proteins a recipe can be built around.
 *
 * ---------------------------------------------------------------------------
 * Why this is one list and not nine
 * ---------------------------------------------------------------------------
 *
 * These values were spelled out in **nine** places: the column's CHECK, the classifier's schema,
 * the classifier's validation set, the extractor's schema, the extractor's validation set, the
 * hand-typed recipe's validation set, the filter chips, the recipe form's picker, and the browse
 * chapters. Adding a value to some of them is worse than adding it to none, and the failure is
 * silent in both directions: a model answering `turkey` against a validation set that has never
 * heard of it is **dropped to null**, and a row carrying a value no chapter holds is in Mains and
 * in none of its subdivisions — present in the database, absent from every screen.
 *
 * So the values live here and the nine sites read them. The three that cannot import a TypeScript
 * array — the migration's CHECK — are compared against this list by a test.
 *
 * ---------------------------------------------------------------------------
 * Why these, and why the first cut of this list was reasoned from the wrong population
 * ---------------------------------------------------------------------------
 *
 * Measured, not guessed. `turkey` was absent, and "Ground Turkey Rice Bowls with Bang Bang Sauce"
 * — turkey in the title — came back `pork` on three readings out of three. **An absent value does
 * not become null; it becomes the nearest available one**, confidently, and nothing downstream has
 * grounds to object.
 *
 * `duck` is in this library zero times and is here anyway, because the cost of its absence is that
 * failure again — a duck recipe becoming `chicken`, wrong in a way a person notices and cannot
 * correct from the screen — while the cost of its presence is a chapter that does not render until
 * a duck arrives. Those are not symmetric. A measured round later put numbers on both halves: duck
 * was used twice and wrong twice under one prompt, and **zero times** under the next, so the cost
 * of presence is a prompt problem rather than an enum problem (decisions §95, §97).
 *
 * `veal`, `venison` and `goat` close the same gap for households that are not this one. The
 * earlier version of this comment justified stopping at eleven by counting *this* library — "no
 * venison, goat, veal, rabbit or bison" — and that is **the wrong population for the question**.
 * A library with none of a thing says nothing about anybody else's: Stephen has no venison, a
 * hunting family in Texas does, and the app is public signup. Same error as judging the protein
 * fill rate library-wide when the question was about Mains (§85).
 *
 * **The chapter cost really is zero**, which is what makes this cheap: `counted` drops empty
 * chapters, so a value with no recipes shows nothing on any screen. The only cost a value carries
 * is a model reaching for it, and that is governed by the classifier's naming bar — what the app
 * may *store* and what the classifier may *assert* are different questions with different fixes.
 *
 * Still not a taxonomy. Plant-protein dishes have `vegetarian` and `vegan`, and the classifier's
 * instructions fold tofu into them in words. Goose, rabbit, bison, tofu-distinct-from-vegetarian
 * and shellfish-distinct-from-seafood are deliberately out of this pass: each needs a drawing, and
 * the sheet has ten.
 */
export const PRINCIPAL_PROTEINS = [
  // grouped so a picker reads in a sensible order: birds, bovine, then the other red meats
  "chicken",
  "turkey",
  "duck",
  "beef",
  "veal",
  "pork",
  "lamb",
  "goat",
  "venison",
  "fish",
  "seafood",
  "egg",
  "vegetarian",
  "vegan",
] as const;

export type PrincipalProtein = (typeof PRINCIPAL_PROTEINS)[number];

const VALUES: ReadonlySet<string> = new Set(PRINCIPAL_PROTEINS);

export const isPrincipalProtein = (value: unknown): value is PrincipalProtein =>
  typeof value === "string" && VALUES.has(value);

/**
 * The same list as a JSON Schema `enum`, null included.
 *
 * Every schema that asks a model for a protein allows null, because a dessert has none and the
 * answer has to be representable — a field that cannot decline is a field that invents. Spelled
 * once here so a schema cannot widen the values and forget the null, or the reverse.
 */
export const PRINCIPAL_PROTEIN_ENUM: ReadonlyArray<string | null> = [...PRINCIPAL_PROTEINS, null];
