import type { ExtractedRecipe, Extractor, FixtureInput } from "../types.js";
import { parseIngredientList } from "../../src/parse.js";

/**
 * Tier 0 as it exists today: core's line parser over whatever text the fixture
 * carries.
 *
 * It reads no URLs and no images — core has no network and no DOM by design —
 * so any input without captured text is skipped rather than guessed at. It also
 * claims no title, servings or time: `parseIngredientList` reads ingredient
 * lines and nothing else, so those fields score zero here and the report says
 * so plainly. That gap is the argument for the extractor tiers above it.
 */
export const coreParser: Extractor = (input: FixtureInput): ExtractedRecipe | null => {
  if (!input.text) return null;
  return { ingredients: parseIngredientList(input.text.split(/\r?\n/)) };
};
