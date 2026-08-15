import type { Fixture } from "../types.js";

/**
 * PLACEHOLDER — demonstrates the `url` shape. Not real data, so it measures
 * nothing. Delete once real fixtures land.
 *
 * A url fixture carries a saved snapshot of the page alongside the address.
 * The eval never fetches: a score you cannot reproduce next month is not a
 * measurement, and `packages/core` has no network.
 */
export const placeholderUrlSnapshot: Fixture = {
  id: "placeholder-url-snapshot",
  placeholder: true,
  source: "invented for this file — replace with a real page",
  notes: "Snapshot trimmed to the ingredient block, which is all tier 0 needs.",
  input: {
    kind: "url",
    url: "https://example.com/placeholder-drop-biscuits",
    text: [
      `<h1>Placeholder Drop Biscuits</h1>`,
      `<p class="yield">Makes 12 biscuits</p>`,
      `<p class="time">Total time: 25 minutes</p>`,
      `<ul class="ingredients">`,
      `<li>1 &frac12; cups all-purpose flour</li>`,
      `<li>&frac12; tsp kosher salt</li>`,
      `<li>1 stick unsalted butter, softened</li>`,
      `<li>2 large eggs</li>`,
      `</ul>`,
    ].join("\n"),
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Placeholder Drop Biscuits",
      servings: 12,
      totalMinutes: 25,
      ingredients: [
        { amount: 1.5, unit: "cup", item: "all-purpose flour" },
        { amount: 0.5, unit: "tsp", item: "kosher salt" },
        { amount: 1, unit: "stick", item: "unsalted butter" },
        { amount: 2, unit: null, item: "eggs" },
      ],
    },
  },
};
