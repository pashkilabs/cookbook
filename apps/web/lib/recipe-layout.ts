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
 * Measured against the real library (67 recipes), the fields the five layouts stand on are:
 *
 *   plan_entries       36 rows over 26 recipes   `rotation`  — built
 *   recipes.course     44 of 67 classified       `browse`    — built
 *   recipes.time_minutes 42 of 67                `time`      — deferred, see below
 *   recipes.principal_protein **25 of 67**       `protein`   — not viable, see below
 *   ratings + history  46 ratings, 10 recipes    `decide`    — deferred
 *
 * **`protein` is not a scheduling deferral.** The handoff called it "the best-populated field —
 * 55 of 66, better than course's 43". It is the *worst* populated of the three: **25 of 67**, under
 * every way of counting (live, including deleted, every household). And it will not fill in:
 * `classified_at` is set on **64 of 67**, so the classifier has already run on nearly everything
 * and **declined to name a protein for 39 of them**. A fridge layout today would offer Pork 11,
 * Chicken 9, Beef 2, Seafood 1, Fish 1, Vegetarian 1 — and hide 42. The reversal condition is the
 * classifier's protein rate, not a backlog.
 *
 * `time` is a genuine scheduling deferral: 42 of 67 is workable with an honest "no time recorded"
 * group. `decide` needs one suggestion with a stated reason, which is §67's standard and a screen
 * of its own.
 */
export const RECIPE_LAYOUTS = ["rotation", "browse", "time", "protein", "decide"] as const;
export type RecipeLayout = (typeof RECIPE_LAYOUTS)[number];

export const isRecipeLayout = (value: unknown): value is RecipeLayout =>
  typeof value === "string" && (RECIPE_LAYOUTS as readonly string[]).includes(value);

/** the question, in the household's words — never "choose a layout" */
export const LAYOUT_CHOICES: ReadonlyArray<{
  value: RecipeLayout;
  label: string;
  description: string;
  /** false where the data cannot support it yet — the option is shown as not ready, not hidden */
  ready: boolean;
  /**
   * Why it is not ready, in the household's words — never "not yet".
   *
   * §71's pattern: say the thing rather than gesture at it. "Soon" and "this would hide 42 of
   * your recipes" are different promises, and a household is entitled to know which it is being
   * given. One is a schedule; the other is a **ceiling**, and a ceiling does not move by waiting.
   */
  notYet?: string;
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
     * A ceiling, stated. The classifier has run on 64 of 67 recipes and named a protein for 25,
     * so this is not a backlog that fills in — and a household told "soon" about it would be told
     * something untrue.
     */
    notYet: "Only 25 of your 67 recipes name a protein, so this would hide 42 of them.",
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
