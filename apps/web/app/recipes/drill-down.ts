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
  { key: "lunch", label: "Lunch", field: "course" },
] as const;

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
