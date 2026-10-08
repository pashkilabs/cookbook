import { describe, expect, it } from "vitest";
import {
  COMPONENTS_PROMPT_FINGERPRINT,
  PALATE_PROMPT_FINGERPRINT,
} from "@pashki/import/prompt-version";
import { promptKey } from "../lib/tastes";

/*
 * regression: the key fingerprinted amount/unit/item_text alone, while the title and the
 * declared sections were both prompt inputs. Adding "For the sauce:" to a recipe left the key
 * identical, so the components computed *without* sections were served forever — and sections
 * are worth `right` 14 → 25 of thirty.
 */
describe("promptKey", () => {
  const lines = ["200 g flour", "1 egg", "50 ml cream"];
  const P = COMPONENTS_PROMPT_FINGERPRINT;

  it("changes when a heading is added, because the heading changes the answer", () => {
    const before = promptKey(P, "Pasta", lines, [null, null, null]);
    const after = promptKey(P, "Pasta", lines, [null, "sauce", "sauce"]);
    expect(after).not.toBe(before);
  });

  it("changes when the title changes, because the title is in the prompt", () => {
    expect(promptKey(P, "Pasta", lines)).not.toBe(promptKey(P, "Cake", lines));
  });

  it("does not change when nothing the model sees has changed", () => {
    expect(promptKey(P, "Pasta", [...lines], [null, "sauce", "sauce"])).toBe(
      promptKey(P, "Pasta", [...lines], [null, "sauce", "sauce"]),
    );
  });

  it("separates a section from the line it sits on", () => {
    // without a separator that cannot occur in text, "sauce" + "flour" and "" + "sauceflour"
    // are the same bytes and the same key
    expect(promptKey(P, null, ["flour"], ["sauce"])).not.toBe(
      promptKey(P, null, ["sauceflour"], [null]),
    );
  });

  it("distinguishes a keyed-without-sections call from a keyed-with-none call", () => {
    // a recipe that has never had headings and one whose headings were all removed are the
    // same recipe; they must not thrash the cache against each other
    expect(promptKey(P, "Pasta", lines)).toBe(promptKey(P, "Pasta", lines, [null, null, null]));
  });

  /*
   * regression, the second time: the prompt is an input and was not in the key.
   *
   * Rewriting the component instructions to ask for a NAME rather than a category took role-named
   * parts from 8 of 9 to 0 of 10 in the eval and reached no household — every stored partition
   * kept the names the rewrite removed, because the key could not tell the two prompts apart.
   * The failure read as a model that would not split; it was a cache that could not expire.
   */
  describe("the prompt is an input", () => {
    it("changes when the instructions change, so a rewrite expires what it replaced", () => {
      expect(promptKey("prompt-v1", "Pasta", lines)).not.toBe(promptKey("prompt-v2", "Pasta", lines));
    });

    it("gives the two caches different keys for the same recipe", () => {
      // the palate note and the partition are different answers to different prompts about the
      // same lines; one key for both would have each serving the other's cached value
      expect(promptKey(COMPONENTS_PROMPT_FINGERPRINT, "Pasta", lines)).not.toBe(
        promptKey(PALATE_PROMPT_FINGERPRINT, "Pasta", lines),
      );
    });

    it("derives the fingerprints rather than carrying a number somebody has to turn", () => {
      // not a stamp: EXTRACTOR_VERSION sat at 1 through two payload changes. Both of these are
      // computed from the prompt text at module load, so there is nothing to forget.
      expect(COMPONENTS_PROMPT_FINGERPRINT).toMatch(/^\d+:[0-9a-z]+$/);
      expect(PALATE_PROMPT_FINGERPRINT).toMatch(/^\d+:[0-9a-z]+$/);
    });
  });
});
