import type { Fixture } from "../types.js";

/**
 * PLACEHOLDER — demonstrates the `screenshot` shape. Not real data, so it
 * measures nothing. Delete once real fixtures land.
 *
 * No image is committed: `images/placeholder-reel.png` does not exist yet, and
 * the harness never opens it. Reading the file is the extractor's job, which
 * keeps `packages/core` free of a filesystem and lets a text-only extractor skip
 * this input honestly instead of scoring zero on it.
 */
export const placeholderScreenshotReel: Fixture = {
  id: "placeholder-screenshot-reel",
  placeholder: true,
  source: "invented for this file — replace with a real reel screenshot",
  notes: "Commit the image alongside the fixture when replacing this.",
  input: {
    kind: "screenshot",
    imagePath: "images/placeholder-reel.png",
  },
  expected: {
    title: "Placeholder Two-Ingredient Pasta",
    // reels rarely state either, and "the source gives none" is a real answer
    servings: null,
    totalMinutes: null,
    ingredients: [
      { amount: 1, unit: "lb", item: "rigatoni" },
      { amount: 0.5, unit: "cup", item: "heavy cream" },
    ],
  },
};
