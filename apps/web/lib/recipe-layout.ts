/**
 * How a household decides what to cook, and what that does to `/recipes`.
 *
 * ---------------------------------------------------------------------------
 * The rule all five obey: never more than about seven at once
 * ---------------------------------------------------------------------------
 *
 * The research the design rests on is consistent on 5–7 items per category, and the thing to take
 * from it is **not** *group them*. "Mains 28" is still 28 once you tap it — so grouping alone moves
 * the overload one screen deeper. Every layout here caps a visible group at seven and puts the rest
 * behind an explicit control.
 *
 * ---------------------------------------------------------------------------
 * Two of the five are built. The measurements say why, and one is not a scheduling reason
 * ---------------------------------------------------------------------------
 *
 * Measured against the real library, the fields the five layouts stand on are:
 *
 *   plan_entries       36 rows over 26 recipes   `rotation`  — built
 *   recipes.course     44 of 67 classified       `browse`    — built
 *   recipes.time_minutes 42 of 67                `time`      — built since
 *   recipes.principal_protein, see below         `protein`   — not built
 *   ratings + history  46 ratings, 10 recipes    `decide`    — built since
 *
 * ---------------------------------------------------------------------------
 * `protein` was refused for a ceiling, and the ceiling is gone
 * ---------------------------------------------------------------------------
 *
 * The refusal said: **25 of 67**, the classifier had already run on 64 of them and declined 39, so
 * a fridge layout would hide 42 and "the reversal condition is the classifier's protein rate, not
 * a backlog." Every word of that was true when it was written.
 *
 * It is no longer true. After the enum gained `turkey` and `duck` (§97), the three-reading vote,
 * and the dairy sentence, the same household reads **53 of its 60 mains** — 88% — and 54 of 80
 * across the whole library. Measured 2026-10-31 against the hosted project.
 *
 * Two lessons, and the second is why the sentence below is a function:
 *
 *   - **A fill rate is a fact about a classifier on a date, not about a column.** An axis refused
 *     on one measurement wants re-measuring after anything that touches the thing filling it.
 *   - **The denominator was the library and the question was about dinners.** A dessert naming no
 *     protein is not a gap a fridge layout has to cover; it is a recipe the layout should not be
 *     asked about. Counting it as a miss is §85's mistake — a column's fill rate is a property of
 *     the subset, and 37% of a library and 88% of its mains are the same column answering two
 *     different questions.
 *
 * So `protein` stays `ready: false`, and the **reason has changed from a ceiling to a schedule**:
 * `/recipes` falls the layout through to the flat list, which is the real blocker. It is said that
 * way below, with the household's own figures rather than this household's.
 *
 * `time` and `decide` were deferred here and have since been built.
 */
export const RECIPE_LAYOUTS = ["rotation", "browse", "time", "protein", "decide"] as const;
export type RecipeLayout = (typeof RECIPE_LAYOUTS)[number];

export const isRecipeLayout = (value: unknown): value is RecipeLayout =>
  typeof value === "string" && (RECIPE_LAYOUTS as readonly string[]).includes(value);

/**
 * What a household's library looks like, for the layouts whose readiness depends on it.
 *
 * `mains` and `mainsNamingProtein` rather than a single rate: a rate cannot say whether the
 * denominator was big enough to mean anything, and 6 of 9 and 53 of 60 are the same percentage
 * about two different amounts of evidence (§83).
 */
export interface LibraryShape {
  /** live recipes in this household */
  total: number;
  /** of those, how many are mains — the only recipes a fridge layout is about */
  mains: number;
  /** of the mains, how many name a principal protein */
  mainsNamingProtein: number;
}

/** the question, in the household's words — never "choose a layout" */
export const LAYOUT_CHOICES: ReadonlyArray<{
  value: RecipeLayout;
  label: string;
  description: string;
  /** false where the data cannot support it yet — the option is shown as not ready, not hidden */
  ready: boolean;
  /**
   * Why it is not ready, in **this household's** words — never "not yet".
   *
   * §71's pattern: say the thing rather than gesture at it. "Soon" and "this would hide 42 of
   * your recipes" are different promises, and a household is entitled to know which it is being
   * given. One is a schedule; the other is a **ceiling**, and a ceiling does not move by waiting.
   *
   * A **function** because the previous version was a string, and a string cannot be right for
   * more than one household. It read *"Only 25 of your 67 recipes name a protein, so this would
   * hide 42 of them"* — three numbers from one household on one day, shown to every household,
   * including one with three recipes and one with none. By the time somebody read it out of a
   * screenshot, all three were wrong and the claim they made had reversed.
   */
  notYet?: (library: LibraryShape) => string;
}> = [
  {
    value: "rotation",
    label: "We cook the same things",
    description: "Your regulars first, by name. Everything else one tap away.",
    ready: true,
  },
  {
    value: "browse",
    label: "We like to browse",
    description: "Chapters, like a cookbook — Mains, Soups, Sides, Desserts.",
    ready: true,
  },
  {
    value: "time",
    label: "Depends how much time we've got",
    description: "Under 30 minutes, under an hour, or a weekend job.",
    ready: true,
  },
  {
    value: "protein",
    label: "We start with what's in the fridge",
    description: "Chicken, pork, fish — pick the thing you already have.",
    ready: false,
    /*
     * A schedule, stated — which is a change of kind from the ceiling this used to report, and the
     * honest answer now that the classifier names a protein on the large majority of mains. The
     * screen is what is missing: `/recipes` falls `protein` through to the flat list.
     *
     * The figure is still given, because "not built yet" on its own is the gesture §71 forbids and
     * because it is the number that would decide whether to build it. Over **mains**, since those
     * are the only recipes the layout would sort.
     */
    notYet: ({ mains, mainsNamingProtein }) =>
      mains === 0
        ? "Nothing here is a dinner yet, so there is nothing to sort by protein — and this screen is not built."
        : `Not built yet. Your recipes would carry it: ${mainsNamingProtein} of your ${mains} dinners name a protein.`,
  },
  {
    value: "decide",
    label: "Just tell us what to cook",
    description: "One suggestion a night, with the reason. Yes, or ask again.",
    ready: true,
  },
];

/** the research's ceiling, and the only number every layout shares */
export const AT_A_TIME = 7;

export interface Planned {
  id: string;
  title: string;
  /** how many times this household has put it on a day — `plan_entries`, not `times_made` */
  planned: number;
  /** the most recent date it was planned for, as the tie-break */
  lastPlanned: string | null;
}

/**
 * The rotation, ordered — and the tie-break is load-bearing rather than tidy.
 *
 * Measured, the planning signal is **flat**: the top eight are 3, 3, 2, 2, 2, 2, 2, 2. The 80/20
 * premise that a household cooks the same eight things is not visible in this data yet, so six
 * recipes are tied at two and the order among them is decided entirely by the tie-break.
 *
 * That makes an unstable sort a visible bug rather than a detail: a page that reorders itself
 * between visits destroys the spatial memory the whole layout is for. So ties break on **most
 * recently planned**, then on **title** — both total orders, so the result is the same on every
 * render and on every machine.
 */
export function rotation(recipes: readonly Planned[], limit = AT_A_TIME): Planned[] {
  return [...recipes]
    .filter((recipe) => recipe.planned > 0)
    .sort(
      (a, b) =>
        b.planned - a.planned ||
        (b.lastPlanned ?? "").localeCompare(a.lastPlanned ?? "") ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}

/*
 * The flat chapter list lived here and is now the tree in `chapters.ts` (§86).
 *
 * It grouped by `course` alone, capped each chapter at seven and offered "show the other 21"
 * underneath — which moved the overload one screen deeper instead of removing it. The tree
 * divides instead, and it also reads `dish_form`, which the flat version could not: a soup is a
 * soup *and* a main, so Soups and Salads are chapters the course column cannot produce.
 *
 * Removed rather than left beside it. Two implementations of "what chapter is this recipe in"
 * is the duplicate shape §78 names, and the one nothing renders is the one that drifts.
 */
