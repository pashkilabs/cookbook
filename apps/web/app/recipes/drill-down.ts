/**
 * The course and protein axes, as the list's drill-down.
 *
 * Lived on `/recipes/browse` until that screen was deleted. It was a second door onto the same
 * recipes and a place you could enter and not leave; the chips do the same work in place, on the
 * list, with their state in the URL so a narrowed view is a link.
 *
 * `field` names the column each course reads. The sketch mixes courses and dish forms in one row
 * because that is how a person thinks about it; the columns stay separate because a soup is a
 * main AND a soup.
 */
export const COURSES = [
  { key: "starter", label: "Appetizers", field: "course" },
  { key: "soup", label: "Soup", field: "dish_form" },
  { key: "salad", label: "Salad", field: "dish_form" },
  { key: "main", label: "Mains", field: "course" },
  { key: "dessert", label: "Desserts", field: "course" },
  { key: "drink", label: "Drinks", field: "course" },
  { key: "breakfast", label: "Breakfast/Brunch", field: "course" },
] as const;

/*
 * `{ key: "lunch", field: "course" }` was here and **could never match a recipe**.
 *
 * `recipes.course` has a CHECK allowing breakfast, starter, main, side, dessert, drink and snack —
 * no lunch — so the chip queried a value the column cannot hold. Verified rather than reasoned:
 * nothing in the library has it, and nothing can be written with it. A filter that always returns
 * nothing is worse than an absent one, because it reads as "we own no lunches".
 *
 * The Harvest handoff asks for a Lunch segment, which is presumably why: the app's own UI offered
 * one. Putting it back needs a migration, which §5 excludes, so it is removed rather than faked.
 *
 * **And the axis has a gap the other way:** `side` holds 5 recipes and `snack` is valid, and
 * neither has a chip — so those are unreachable by drill-down. Adding them changes what the
 * screen offers, which is a product decision rather than a restyle, so it is reported not done.
 */

/**
 * Fixed order so chips do not reshuffle as recipes arrive; which of them *appear* is decided by
 * the household's own data, not by this list.
 *
 * Kid-friendly is deliberately absent: it is not a protein, and it now sits with the household's
 * other judgement filters where a reader does not have to notice that one chip in a row is unlike
 * the rest.
 */
export const PROTEINS = [
  "chicken", "beef", "pork", "lamb", "fish", "seafood", "egg", "vegetarian", "vegan",
] as const;

export const label = (key: string) => key[0]!.toUpperCase() + key.slice(1);
