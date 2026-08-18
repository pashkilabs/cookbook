/**
 * The eight groups, defined once.
 *
 * Read by both the landing page's tiles and the browse screen itself. Two copies would drift,
 * and the point of the grouping is that it is the same wherever a person meets it.
 *
 * `field` names which column each row reads — course, or dish_form. The sketch mixes the axes
 * because that is how a person thinks about it; the columns stay separate because a soup is a
 * main AND a soup.
 */
export const TOP_LEVEL = [
  { key: "starter", label: "Appetizers", field: "course" },
  { key: "soup", label: "Soup", field: "dish_form" },
  { key: "salad", label: "Salad", field: "dish_form" },
  { key: "main", label: "Mains", field: "course" },
  { key: "dessert", label: "Desserts", field: "course" },
  { key: "drink", label: "Drinks", field: "course" },
  { key: "breakfast", label: "Breakfast/Brunch", field: "course" },
  { key: "lunch", label: "Lunch", field: "course" },
] as const;
