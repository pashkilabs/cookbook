import type { Fixture } from "../types.js";

/**
 * Handwritten cards from a real binder — the input class the Photograph channel exists for.
 *
 * Every vision number before these came from reel screenshots: rendered text at 12px over video.
 * These are ink on ruled card, photographed on a phone, and nothing like them has been measured.
 *
 * **Expected output is hand-read from the image, and some of these need Stephen** — a faded
 * cursive quantity that the person who wrote it can read and I cannot must not be guessed at,
 * because a wrong expectation makes a correct extractor look broken and sends somebody debugging
 * the wrong thing (`intake/README.md`).
 */

/**
 * The two-scale trap, and the reason it is first.
 *
 * The card carries the recipe twice: a left column for an 8" square pan and a right column for a
 * 9x13 — `2 squares` / `4 squares`, `1 stick` / `2 sticks`, `1 C. sugar` / `2 C.`. A model reading
 * across the page produces one list correct for neither, and it will look entirely plausible: the
 * review screen cannot catch it, because nothing on the screen says two recipes were merged.
 *
 * **The expectation is the left column**, because the method names it — "Line 8" square pan" — so
 * the card's own instructions settle which scale is the recipe and which is the variant. An
 * extractor answering the right column is wrong; one answering a mixture is the failure that
 * matters.
 */
export const card_chocolate_peppermint_bars: Fixture = {
  id: "photo-chocolate-peppermint-bars",
  input: { kind: "screenshot", imagePath: "card-7320.jpg" },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Chocolate Peppermint Bars",
      servings: null,
      totalMinutes: 20,
      ingredients: [
        { amount: 2, unit: null, item: "squares unsweetened chocolate", section: "Brownie Layer" },
        { amount: 1, unit: "stick", item: "butter", section: "Brownie Layer" },
        { amount: 2, unit: null, item: "eggs", section: "Brownie Layer" },
        { amount: 1, unit: "cup", item: "sugar", section: "Brownie Layer" },
        { amount: 0.5, unit: "cup", item: "flour", section: "Brownie Layer" },
        { amount: 1.5, unit: "cup", item: "powdered sugar", section: "Frosting" },
        { amount: 3, unit: "tbsp", item: "butter", section: "Frosting" },
        { amount: 1.5, unit: "tbsp", item: "milk", section: "Frosting" },
        { amount: 1, unit: "tsp", item: "peppermint extract", section: "Frosting" },
        { amount: 1.5, unit: null, item: "squares unsweetened chocolate", section: "Topping" },
        { amount: 1.5, unit: "tbsp", item: "butter", section: "Topping" },
      ],
    },
  },
  notes:
    "TWO SCALES ON ONE CARD. Left column is the recipe (the method says 8\" square pan); the " +
    "right column doubles everything for a 9x13. An extractor answering 4 squares / 2 sticks / " +
    "2 C has read the variant; one answering a mixture of both is the failure that matters. " +
    "Source on the card is 'Mom O.' — better provenance than any URL, and it maps to " +
    "recipes.source_name with no schema change. totalMinutes 20 from 'Bake at 350 for 20 min'.",
};
