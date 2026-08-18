import { describe, expect, it } from "vitest";
import { CAPTION_STEP_EXPECTATIONS, scoreCourse, scoreCuisine, scoreSteps } from "../eval/fixtures/caption-steps.js";

describe("scoring a method by presence and order", () => {
  const fragments = ["melt the butter", "add the shrimp", "serve and enjoy"];

  it("ignores punctuation and case, so a full stop is not a miss", () => {
    const score = scoreSteps(fragments, [
      "Melt the butter in a large pan.",
      "Add the shrimp, and stir.",
      "Serve and enjoy!",
    ]);
    expect(score.matched).toBe(3);
    expect(score.missing).toEqual([]);
  });

  it("ignores a step's leading decoration, which render strips anyway", () => {
    expect(scoreSteps(["add the shrimp"], ["💕Add the shrimp, and stir"]).matched).toBe(1);
  });

  it("scores a shuffled method below the same steps in order", () => {
    const right = scoreSteps(fragments, ["melt the butter", "add the shrimp", "serve and enjoy"]);
    const shuffled = scoreSteps(fragments, ["serve and enjoy", "melt the butter", "add the shrimp"]);
    expect(right.matched).toBe(3);
    expect(shuffled.matched).toBeLessThan(right.matched);
  });

  it("does not penalise a method split finer than expected", () => {
    const score = scoreSteps(fragments, [
      "melt the butter", "let it foam", "add the shrimp", "stir for four minutes", "serve and enjoy",
    ]);
    expect(score.matched).toBe(3);
    expect(score.returned).toBe(5);
  });

  it("names what is missing rather than only counting", () => {
    const score = scoreSteps(fragments, ["melt the butter"]);
    expect(score.missing).toEqual(["add the shrimp", "serve and enjoy"]);
  });

  // regression: every caption returned steps: [] while the prompt asked only for ingredients
  it("scores an empty method zero rather than treating it as nothing to check", () => {
    const score = scoreSteps(fragments, []);
    expect(score.matched).toBe(0);
    expect(score.missing).toHaveLength(3);
  });
});

describe("the four caption step expectations", () => {
  it("covers the four step formats that were all returning nothing", () => {
    expect(CAPTION_STEP_EXPECTATIONS).toHaveLength(4);
    expect(CAPTION_STEP_EXPECTATIONS.map((e) => e.format.split(" ")[0])).toEqual([
      "DIRECTIONS:", "every", "no", "no",
    ]);
  });

  it("gives every fixture a fragment per step and no duplicates within a recipe", () => {
    for (const expectation of CAPTION_STEP_EXPECTATIONS) {
      expect(expectation.fragments.length, expectation.fixture).toBeGreaterThan(0);
      const unique = new Set(expectation.fragments.map((f) => f.toLowerCase()));
      // a fragment repeated within one recipe cannot identify a step
      expect(unique.size, expectation.fixture).toBe(expectation.fragments.length);
    }
  });
});

describe("scoring course and cuisine as three outcomes", () => {
  it("separates a decline from a wrong answer, because the prompt moves opposite ways", () => {
    expect(scoreCourse(["main"], null)).toBe("declined");
    expect(scoreCourse(["main"], "snack")).toBe("wrong");
    expect(scoreCourse(["main"], "main")).toBe("right");
  });

  it("accepts any of a genuinely ambiguous dish's courses", () => {
    // cinnamon rolls are breakfast and dessert; forcing one measures my opinion, not the model
    expect(scoreCourse(["dessert", "breakfast"], "breakfast")).toBe("right");
    expect(scoreCourse(["dessert", "breakfast"], "snack")).toBe("wrong");
  });

  it("treats casing and hyphenation as noise, and genuine variants as the same answer", () => {
    expect(scoreCuisine("italian", "Italian")).toBe("right");
    expect(scoreCuisine("italian", "Italian-American")).toBe("right");
    expect(scoreCuisine("mexican", "Tex-Mex")).toBe("right");
  });

  it("scores a broader answer as a miss — Asian for a Thai dish is worse, not equivalent", () => {
    expect(scoreCuisine("thai", "Asian")).toBe("wrong");
  });

  it("counts naming a cuisine the source never gave as wrong, not as a bonus", () => {
    expect(scoreCuisine(null, "Italian")).toBe("wrong");
    expect(scoreCuisine(null, null)).toBe("right");
  });
});
