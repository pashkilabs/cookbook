import type { Fixture } from "../types.js";

/**
 * PLACEHOLDER — demonstrates the `caption` shape. Not real data, so it measures
 * nothing. Delete once real fixtures land.
 *
 * A caption is pasted whole, exactly as a user would paste it: title line,
 * yield line, section heading and ingredients all mixed together. The expected
 * output is the recipe inside it, which is why tier 0 shows spurious lines here
 * — a line parser has no way to know the title is not an ingredient.
 */
export const placeholderCaptionPaste: Fixture = {
  id: "placeholder-caption-paste",
  placeholder: true,
  source: "invented for this file — replace with a real caption",
  input: {
    kind: "caption",
    text: [
      `Creamy Placeholder Chicken`,
      `Serves 4 | 30 minutes`,
      ``,
      `For the sauce:`,
      `1 cup heavy cream`,
      `3 cloves garlic, minced`,
      `2 tbsp olive oil`,
      `1 (14.5 oz) can diced tomatoes`,
      `Salt and pepper to taste`,
    ].join("\n"),
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Creamy Placeholder Chicken",
      servings: 4,
      totalMinutes: 30,
      ingredients: [
        { amount: 1, unit: "cup", item: "heavy cream" },
        { amount: 3, unit: "clove", item: "garlic" },
        { amount: 2, unit: "tbsp", item: "olive oil" },
        // the tin states its size, so the truth is a weight rather than a count
        { amount: 14.5, unit: "oz", item: "diced tomatoes" },
        { amount: null, unit: null, item: "salt and pepper" },
      ],
    },
  },
};
