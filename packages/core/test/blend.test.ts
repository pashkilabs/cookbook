import { describe, expect, it } from "vitest";
import { composeBlend, partIsIntact, servingsDisagreement, type BlendPart } from "../src/blend.js";

const line = (itemText: string, extra: Partial<BlendPart["ingredients"][number]> = {}) => ({
  amount: 1, unit: null, itemText, note: "", isEstimated: false, section: null, ...extra,
});

const glaze: BlendPart = {
  sourceRecipeId: "a", sourceTitle: "Slow-braised pork belly", componentName: "the glaze",
  role: "sauce", taken: "component", adjusted: false, agreement: 0.9, readings: 3,
  ingredients: [line("honey"), line("soy sauce")],
  steps: ["Reduce the glaze."],
};
const cod: BlendPart = {
  sourceRecipeId: "b", sourceTitle: "Roast cod", componentName: "the cod",
  role: "protein", taken: "component", adjusted: true, agreement: 0.6, readings: 3,
  ingredients: [line("cod fillets"), line("olive oil")],
  steps: ["Roast the cod.", "Rest it."],
};

describe("composeBlend", () => {
  it("keeps every quantity exactly as its own recipe wrote it", () => {
    // §60 version one changes no quantities, and this is the test that says so
    const blend = composeBlend([glaze, cod]);
    expect(blend.ingredients.map((i) => i.amount)).toEqual([1, 1, 1, 1]);
    expect(blend.ingredients.map((i) => i.itemText)).toEqual([
      "honey", "soy sauce", "cod fillets", "olive oil",
    ]);
  });

  it("records where each part landed in the blend's own list", () => {
    const blend = composeBlend([glaze, cod]);
    expect(blend.parts.map((p) => [p.componentName, p.ingredientsFrom, p.ingredientsTo])).toEqual([
      ["the glaze", 0, 1],
      ["the cod", 2, 3],
    ]);
    expect(blend.parts.map((p) => [p.stepsFrom, p.stepsTo])).toEqual([[0, 0], [1, 2]]);
  });

  it("makes the part's name the heading, so the blend shows its own structure", () => {
    const blend = composeBlend([glaze, cod]);
    expect(blend.ingredients.map((i) => i.section)).toEqual([
      "the glaze", "the glaze", "the cod", "the cod",
    ]);
  });

  it("keeps a whole recipe's own headings, because taking all of it keeps its shape", () => {
    const whole: BlendPart = {
      ...glaze, taken: "whole", componentName: "Slow-braised pork belly",
      ingredients: [line("honey", { section: "Glaze" }), line("pork belly", { section: null })],
    };
    const blend = composeBlend([whole]);
    expect(blend.ingredients.map((i) => i.section)).toEqual(["Glaze", null]);
  });

  it("refuses to claim a role or an agreement for a whole take", () => {
    // a whole take used no partition, so it has nothing to be confident or unsure about
    const blend = composeBlend([{ ...glaze, taken: "whole" }]);
    expect(blend.parts[0]?.role).toBeNull();
    expect(blend.parts[0]?.agreement).toBeNull();
    expect(blend.parts[0]?.readings).toBeNull();
  });

  it("states no servings, because two parts written for 4 and 2 do not make a number", () => {
    expect(composeBlend([glaze, cod]).servings).toBeNull();
  });

  it("drops a part contributing nothing rather than storing an impossible range", () => {
    // an inclusive from..to cannot express "nothing", and 0..-1 is a lie every reader inherits
    const blend = composeBlend([glaze, { ...cod, ingredients: [] }]);
    expect(blend.parts).toHaveLength(1);
  });

  it("carries a part with no method at all, which §19 makes a real case", () => {
    const blend = composeBlend([{ ...glaze, steps: [] }]);
    expect(blend.parts[0]?.stepsFrom).toBeNull();
    expect(blend.parts[0]?.stepsKey).toBeNull();
  });

  it("remembers that a person moved the boundaries", () => {
    expect(composeBlend([glaze, cod]).parts.map((p) => p.adjusted)).toEqual([false, true]);
  });
});

describe("partIsIntact", () => {
  const blend = composeBlend([glaze, cod]);
  const asRead = { ingredients: blend.ingredients, steps: blend.steps.map((s) => s.text) };

  it("is intact when nothing has been edited", () => {
    expect(blend.parts.every((p) => partIsIntact(p, asRead))).toBe(true);
  });

  it("notices an edited ingredient line and does not draw a heading over the wrong rows", () => {
    const edited = {
      ...asRead,
      ingredients: asRead.ingredients.map((i, at) => (at === 0 ? { ...i, itemText: "maple syrup" } : i)),
    };
    expect(partIsIntact(blend.parts[0]!, edited)).toBe(false);
    // and the part that was not touched is unaffected
    expect(partIsIntact(blend.parts[1]!, edited)).toBe(true);
  });

  it("notices an edited step, which no ingredient key could see", () => {
    const edited = { ...asRead, steps: ["Reduce the glaze hard.", "Roast the cod.", "Rest it."] };
    expect(partIsIntact(blend.parts[0]!, edited)).toBe(false);
  });

  it("notices lines removed from under it rather than silently covering fewer", () => {
    // slice would return a short array and a naive key check would compare the wrong thing
    const edited = { ...asRead, ingredients: asRead.ingredients.slice(0, 3) };
    expect(partIsIntact(blend.parts[1]!, edited)).toBe(false);
  });
});

describe("servingsDisagreement", () => {
  it("names both figures rather than reconciling them", () => {
    expect(servingsDisagreement([
      { componentName: "the glaze", servings: 4 },
      { componentName: "the cod", servings: 2 },
    ])).toEqual([
      { componentName: "the glaze", servings: 4 },
      { componentName: "the cod", servings: 2 },
    ]);
  });

  it("says nothing when they agree", () => {
    expect(servingsDisagreement([
      { componentName: "a", servings: 4 }, { componentName: "b", servings: 4 },
    ])).toBeNull();
  });

  it("says nothing when only one part states a figure, which is not a disagreement", () => {
    expect(servingsDisagreement([
      { componentName: "a", servings: 4 }, { componentName: "b", servings: null },
    ])).toBeNull();
  });
});
