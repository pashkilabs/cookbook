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
 * Why turkey and duck, and why not more
 * ---------------------------------------------------------------------------
 *
 * Measured, not guessed. `turkey` was absent, and "Ground Turkey Rice Bowls with Bang Bang Sauce"
 * — turkey in the title — came back `pork` on three readings out of three. **An absent value does
 * not become null; it becomes the nearest available one**, confidently, and nothing downstream has
 * grounds to object.
 *
 * `duck` is in the library zero times. It is here anyway, because the cost of its absence is that
 * failure again — a duck recipe becoming `chicken`, which is the kind of wrong a person notices
 * and cannot correct from the screen — and the cost of its presence is a chapter that does not
 * render until a duck arrives. The two are not symmetric.
 *
 * Nothing else was added, and the library is why: across all 76 recipes' titles, ingredients,
 * notes and steps there is no tofu, tempeh, seitan, paneer, venison, goat, veal, rabbit or bison,
 * one chickpea and no lentils. Plant-protein dishes have `vegetarian` and `vegan` already, and the
 * classifier's instructions fold tofu into them in words. This is the same discipline the dish-form
 * list was written with: assert what is known rather than build a taxonomy nobody has asked for.
 */
export const PRINCIPAL_PROTEINS = [
  "chicken",
  "turkey",
  "duck",
  "beef",
  "pork",
  "lamb",
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
