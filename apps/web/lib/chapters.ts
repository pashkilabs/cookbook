/**
 * The Lundall Recipe Book — the chapter tree.
 *
 * ---------------------------------------------------------------------------
 * A chapter that outgrows a screen divides into chapters
 * ---------------------------------------------------------------------------
 *
 * Paige's rule, and it is the whole idea. `browse` used to be a flat list of chapters each capped
 * at seven with "show the other 21" underneath — which moved the overload one screen deeper
 * rather than removing it. A tree answers it: the contents page is one screen of chapters, and
 * the one chapter too big for a screen becomes a screen of chapters itself.
 *
 * ---------------------------------------------------------------------------
 * Two columns, deliberately, so the counts do not sum
 * ---------------------------------------------------------------------------
 *
 * Soups and Salads come from `dish_form`; every other chapter comes from `course`. That is §84's
 * finding rather than an inconsistency — **a soup is a soup and a main**, and the two columns
 * exist because one question is "what course is this" and the other is "what shape is it".
 *
 * The consequence is that a recipe appears under both, the chapter counts add up to more than the
 * library, and that is correct. Measured on the real library: the ten chapters sum to 73 over 67
 * recipes, because five soups and one salad are also mains. §-browse already decided this is how
 * people look for things and not a bug to design out, so there is **no tie-break** here and the
 * numbers are not made to reconcile.
 *
 * ---------------------------------------------------------------------------
 * The subdivision rule, and its honest limit
 * ---------------------------------------------------------------------------
 *
 * Divide a chapter **only where an axis exists and the chapter exceeds seven.** Measured on the
 * real library, exactly one chapter satisfies both:
 *
 *   Mains        32   `principal_protein` exists as an axis   -> divides into six groups
 *   Not sorted   23   no axis by definition                   -> lists them; search and A-Z
 *   Soups         5   under seven anyway, and has no axis     -> lists them
 *
 * **Soups does not divide**, and the next reader is owed both halves of why: it is at five today,
 * comfortably under the cap, and if it ever crossed it there is still nothing to divide it *by* —
 * `dish_form` is the column that put it in this chapter, so it cannot also be the axis inside it.
 * A soup chapter at nine lists nine. That is the rule working, not a gap in it.
 *
 * ---------------------------------------------------------------------------
 * The protein axis works inside Mains even though it fails library-wide
 * ---------------------------------------------------------------------------
 *
 * §85 recorded that `principal_protein` is named on **25 of 67** recipes and refused the fridge
 * layout on that ceiling. The refusal was right when it was made, and both of its figures have
 * since moved: a backfill, a `turkey` value, a consensus of three readings and two prompt
 * corrections put the library at **54 of 76 = 71%** and Mains at **53 of 57 = 93%** (measured
 * 2026-10-24, decisions §93–§95). The denominator moved too — Mains is 57 rather than 32, because
 * the same classifier fills in `course`.
 *
 * So the subdivision this file does is now comfortable rather than marginal, and **the ceiling
 * that justified refusing the fridge layout is no longer the ceiling that was refused**. That is
 * not a licence to build it: it is a note that the premise is stale, and that the question is open
 * again rather than settled. Re-measure before quoting either figure — a fill rate is a property
 * of the subset and of the week it was taken in.
 */
import type { RecipeRow } from "./recipe-search";

/** the research's ceiling, shared with every other layout */
export { AT_A_TIME } from "./recipe-layout";
import { AT_A_TIME } from "./recipe-layout";

/** the classification fields a chapter can be cut on — a row shape, not the whole recipe */
export interface Classified {
  course: string | null;
  dish_form: string | null;
  principal_protein: string | null;
}

export interface Chapter {
  /** the URL segment: /recipes/c/<slug> */
  slug: string;
  label: string;
  /** the file under `public/chapters/`, rendered as a CSS mask — never an `<img>` (see §86) */
  icon: string;
  /** which rows belong here */
  holds: (recipe: Classified) => boolean;
  /** stated on the chapter's own page, so somebody can see what put a recipe in it */
  source: string;
}

/**
 * The ten chapters, exactly as the designer's mapping defines them.
 *
 * Order is the contents page's reading order, not an alphabet: Mains first because it is most of
 * the cooking, "Not sorted yet" last because it is the one chapter somebody opens to empty.
 */
export const TOP_LEVEL: readonly Chapter[] = [
  { slug: "main", label: "Mains", icon: "dinner.png", source: "course is main", holds: (r) => r.course === "main" },
  { slug: "soup", label: "Soups", icon: "soup.png", source: "shaped like a soup", holds: (r) => r.dish_form === "soup" },
  { slug: "salad", label: "Salads", icon: "salad.png", source: "shaped like a salad", holds: (r) => r.dish_form === "salad" },
  { slug: "side", label: "Sides", icon: "sides.png", source: "course is side", holds: (r) => r.course === "side" },
  /* skewers, not the meat platter: the platter was drawn for something else and only ever borrowed
     because the first sheet had nothing for this chapter. Paige commissioned the skewers to close
     that gap, so the platter is now spare and nothing should reference it — a reader who "restores"
     it is undoing the fix, not finding one. Measured against the set before swapping: ink 18.6%
     against a median of 17.4%, aspect 0.807 to poultry's 0.815, so it needs no special size. */
  { slug: "starter", label: "Appetisers", icon: "skewers.png", source: "course is starter", holds: (r) => r.course === "starter" },
  { slug: "snack", label: "Snacks", icon: "snacks.png", source: "course is snack", holds: (r) => r.course === "snack" },
  { slug: "dessert", label: "Desserts", icon: "desserts.png", source: "course is dessert", holds: (r) => r.course === "dessert" },
  { slug: "breakfast", label: "Breakfast", icon: "breakfast.png", source: "course is breakfast", holds: (r) => r.course === "breakfast" },
  { slug: "drink", label: "Drinks", icon: "cocktail.png", source: "course is drink", holds: (r) => r.course === "drink" },
  {
    slug: "unsorted",
    label: "Not sorted yet",
    icon: "groceries.png",
    source: "no course recorded",
    holds: (r) => r.course === null,
  },
];

/**
 * Mains, by principal protein.
 *
 * `unassigned` is last and is **named rather than hidden**: `course='main' AND principal_protein
 * IS NULL` is 10 of the 32 mains, and §84's lesson was that a category with no name is worse than
 * an awkward one. It is a real group — "the mains we have not classified" — not a leak.
 */
export const MAINS_BY_PROTEIN: readonly Chapter[] = [
  { slug: "pork", label: "Pork", icon: "pork.png", source: "pork", holds: (r) => r.principal_protein === "pork" },
  { slug: "chicken", label: "Chicken", icon: "chicken.png", source: "chicken", holds: (r) => r.principal_protein === "chicken" },
  /*
   * Every protein now has its own drawing, including the ones this household will never cook.
   *
   * Turkey and duck borrowed `meat-platter.png` because no bird but the chicken had been drawn,
   * and lending the chicken's face to Turkey would have put a chicken on the tile beside the
   * Chicken tile. Both have their own now, and `poultry.png` is renamed `chicken.png` to match
   * the enum value it serves — the old name invited exactly that lending.
   *
   * `veal`, `venison` and `goat` are here with zero recipes in this library, and that costs
   * nothing on any screen: `counted` drops empty chapters, which is why a value can be added
   * before anybody cooks one. It is also why the icon has to exist up front — the tile appears
   * the moment a household's first venison lands, and a mask pointing at a 404 paints nothing.
   */
  { slug: "turkey", label: "Turkey", icon: "turkey.png", source: "turkey", holds: (r) => r.principal_protein === "turkey" },
  { slug: "duck", label: "Duck", icon: "duck.png", source: "duck", holds: (r) => r.principal_protein === "duck" },
  { slug: "beef", label: "Beef", icon: "beef.png", source: "beef", holds: (r) => r.principal_protein === "beef" },
  { slug: "veal", label: "Veal", icon: "veal.png", source: "veal", holds: (r) => r.principal_protein === "veal" },
  { slug: "lamb", label: "Lamb", icon: "lamb.png", source: "lamb", holds: (r) => r.principal_protein === "lamb" },
  { slug: "goat", label: "Goat", icon: "goat.png", source: "goat", holds: (r) => r.principal_protein === "goat" },
  { slug: "venison", label: "Venison", icon: "venison.png", source: "venison", holds: (r) => r.principal_protein === "venison" },
  { slug: "fish", label: "Fish", icon: "fish.png", source: "fish", holds: (r) => r.principal_protein === "fish" },
  { slug: "seafood", label: "Seafood", icon: "seafood.png", source: "seafood", holds: (r) => r.principal_protein === "seafood" },
  { slug: "egg", label: "Eggs", icon: "eggs.png", source: "eggs", holds: (r) => r.principal_protein === "egg" },
  {
    slug: "vegetarian",
    label: "Meat-free",
    icon: "vegetarian.png",
    source: "no meat",
    holds: (r) => r.principal_protein === "vegetarian" || r.principal_protein === "vegan",
  },
  {
    slug: "unassigned",
    label: "Everything else",
    // no icon: it is the absence of a protein, and borrowing a drawing would name it wrongly
    icon: "",
    source: "no protein recorded",
    holds: (r) => r.principal_protein === null,
  },
];

export interface Counted {
  chapter: Chapter;
  count: number;
}

/**
 * Count each chapter and drop the empty ones.
 *
 * **A chapter with nothing in it does not appear.** Snacks is 0 on the real library and Lamb, Eggs
 * and Meat-free are all 0 inside Mains — four empty tiles the wireframe drew because its figures
 * were illustrative. An empty tile is a door onto nothing, which reads as a broken app rather
 * than as an honest library.
 */
export function counted(recipes: readonly Classified[], within: readonly Chapter[] = TOP_LEVEL): Counted[] {
  return within
    .map((chapter) => ({ chapter, count: recipes.filter((recipe) => chapter.holds(recipe)).length }))
    .filter((entry) => entry.count > 0);
}

/** the chapter a slug names, or null — `null` is a 404, never a silent fallback to Mains */
export function chapterBySlug(slug: string, within: readonly Chapter[] = TOP_LEVEL): Chapter | null {
  return within.find((chapter) => chapter.slug === slug) ?? null;
}

/**
 * Does this chapter divide, and into what?
 *
 * Both halves of the rule in one place: an axis has to exist **and** the chapter has to exceed
 * seven. Mains is the only chapter with an axis at all, so everything else lists its recipes —
 * and Mains itself would list them too if it were under the cap.
 */
export function subdivision(chapter: Chapter, count: number): readonly Chapter[] | null {
  if (chapter.slug !== "main") return null;
  if (count <= AT_A_TIME) return null;
  return MAINS_BY_PROTEIN;
}

/** the path to a chapter's page */
export function chapterHref(slug: string, parent?: string): string {
  return parent ? `/recipes/c/${parent}/${slug}` : `/recipes/c/${slug}`;
}

/**
 * The URL a chapter icon is masked from.
 *
 * One function so the path exists once: `check-chapter-icons.mjs` greps for `public/chapters`
 * reached through an `<img>`, and a second spelling of this path is a second place for that
 * mistake to hide.
 */
export function iconUrl(icon: string): string {
  return `url(/chapters/${icon})`;
}
