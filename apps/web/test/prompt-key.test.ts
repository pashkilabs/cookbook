import { describe, expect, it } from "vitest";
import { promptKey } from "../lib/tastes";

/*
 * regression: the key fingerprinted amount/unit/item_text alone, while the title and the
 * declared sections were both prompt inputs. Adding "For the sauce:" to a recipe left the key
 * identical, so the components computed *without* sections were served forever — and sections
 * are worth `right` 14 → 25 of thirty.
 */
describe("promptKey", () => {
  const lines = ["200 g flour", "1 egg", "50 ml cream"];

  it("changes when a heading is added, because the heading changes the answer", () => {
    const before = promptKey("Pasta", lines, [null, null, null]);
    const after = promptKey("Pasta", lines, [null, "sauce", "sauce"]);
    expect(after).not.toBe(before);
  });

  it("changes when the title changes, because the title is in the prompt", () => {
    expect(promptKey("Pasta", lines)).not.toBe(promptKey("Cake", lines));
  });

  it("does not change when nothing the model sees has changed", () => {
    expect(promptKey("Pasta", [...lines], [null, "sauce", "sauce"])).toBe(
      promptKey("Pasta", [...lines], [null, "sauce", "sauce"]),
    );
  });

  it("separates a section from the line it sits on", () => {
    // without a separator that cannot occur in text, "sauce" + "flour" and "" + "sauceflour"
    // are the same bytes and the same key
    expect(promptKey(null, ["flour"], ["sauce"])).not.toBe(promptKey(null, ["sauceflour"], [null]));
  });

  it("distinguishes a keyed-without-sections call from a keyed-with-none call", () => {
    // a recipe that has never had headings and one whose headings were all removed are the
    // same recipe; they must not thrash the cache against each other
    expect(promptKey("Pasta", lines)).toBe(promptKey("Pasta", lines, [null, null, null]));
  });
});
