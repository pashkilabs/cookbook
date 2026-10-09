import { describe, expect, it } from "vitest";
import { readAllergen, readAllergens } from "../src/index.js";

const verdict = (lines: string[], allergen: Parameters<typeof readAllergen>[1]) =>
  readAllergen(lines, allergen).verdict;

describe("the allergen matcher keeps the modifier the catalog throws away", () => {
  // regression in spirit: the catalog matched a head noun, so `almond milk` bought whole milk.
  // That is the exact failure this must not inherit — the modifier IS the answer here.
  it("sees almond in almond milk", () => {
    expect(verdict(["2 cups almond milk"], "tree-nut")).toBe("excluded");
  });

  it("quotes the line back, so a person can check the reasoning rather than trust it", () => {
    expect(readAllergen(["1 cup chopped walnuts"], "tree-nut").matched).toEqual([
      "1 cup chopped walnuts",
    ]);
  });

  it("does not find a tree nut in nutmeg, butternut squash or coconut", () => {
    for (const line of ["1 tsp nutmeg", "1 butternut squash", "400 ml coconut milk"]) {
      expect(verdict([line], "tree-nut"), line).not.toBe("excluded");
    }
  });

  it("does not find an egg in eggplant", () => {
    expect(verdict(["1 large eggplant"], "egg")).toBe("clear");
  });

  it("matches a plural without a stemmer, and never strips a letter", () => {
    expect(verdict(["3 eggs"], "egg")).toBe("excluded");
    // `scallion` must not become `scallio`: nothing is removed, only an `s` added
    expect(verdict(["2 scallions"], "shellfish")).toBe("clear");
  });
});

describe("what it cannot see, it says it cannot see", () => {
  it("calls a jar of curry paste unknown rather than clear", () => {
    const reading = readAllergen(["2 tbsp red curry paste", "400 ml coconut milk"], "fish");
    expect(reading.verdict).toBe("unknown");
    expect(reading.opaque).toEqual(["2 tbsp red curry paste"]);
  });

  it("calls pesto unknown for tree nuts, because the pine nuts are inside the jar", () => {
    expect(verdict(["1/4 cup pesto", "200 g pasta"], "tree-nut")).toBe("unknown");
  });

  it("calls a brioche bun unknown for milk and egg", () => {
    expect(verdict(["4 brioche buns"], "milk")).toBe("unknown");
    expect(verdict(["4 brioche buns"], "egg")).toBe("unknown");
  });

  // tamari is wheat-free and soy sauce is not, which is why no per-product table would work
  it("calls soy sauce excluded for soy and unknown for wheat", () => {
    expect(verdict(["2 tbsp soy sauce"], "soy")).toBe("excluded");
    expect(verdict(["2 tbsp soy sauce"], "wheat")).toBe("unknown");
  });

  it("treats a line the caller could not recognise as unknown, never as clear", () => {
    const reading = readAllergen(["1 packet of gefilte"], "fish", {
      unrecognised: ["1 packet of gefilte"],
    });
    expect(reading.verdict).toBe("unknown");
    expect(reading.unrecognised).toEqual(["1 packet of gefilte"]);
  });

  it("lets a named allergen outrank an unknown, because there is nothing provisional about it", () => {
    // a definite peanut in a recipe that also holds an opaque jar is still a definite peanut
    expect(verdict(["2 tbsp peanut butter", "1 tbsp curry paste"], "peanut")).toBe("excluded");
  });
});

describe("clear means nothing we could see, and only that", () => {
  it("reports clear for a recipe of recognised primitives with no match", () => {
    const reading = readAllergen(["2 carrots", "1 onion", "500 g beef mince"], "milk");
    expect(reading.verdict).toBe("clear");
    expect(reading.matched).toEqual([]);
    expect(reading.opaque).toEqual([]);
  });

  it("reads every allergen separately rather than collapsing to one worst case", () => {
    // "excluded for peanut, unknown for milk" is two things to tell two people
    const readings = readAllergens(["2 tbsp peanut butter", "4 brioche buns"], ["peanut", "milk"]);
    expect(readings.get("peanut")?.verdict).toBe("excluded");
    expect(readings.get("milk")?.verdict).toBe("unknown");
  });

  it("ignores a blank line rather than counting it as unrecognised", () => {
    expect(verdict(["", "   ", "2 carrots"], "fish")).toBe("clear");
  });
});

describe("a phrase that contains an allergen's word and is not that allergen", () => {
  // found by the suite: `butter` is a dairy term, so `peanut butter` matched milk
  it("does not find dairy in peanut butter or almond butter", () => {
    expect(verdict(["2 tbsp peanut butter"], "milk")).toBe("clear");
    expect(verdict(["1 tbsp almond butter"], "milk")).toBe("clear");
  });

  it("does not find dairy in coconut milk, which a quarter of this corpus uses", () => {
    expect(verdict(["400 ml coconut milk"], "milk")).toBe("clear");
    expect(verdict(["1 cup coconut cream"], "milk")).toBe("clear");
  });

  it("does not find wheat in almond flour or rice noodles", () => {
    expect(verdict(["200 g almond flour"], "wheat")).toBe("clear");
    expect(verdict(["150 g rice noodles"], "wheat")).toBe("clear");
  });

  it("does not find a tree nut in a water chestnut", () => {
    expect(verdict(["1 tin water chestnuts"], "tree-nut")).toBe("clear");
  });

  // the exemption must not become a false negative: the phrase is cut, not the line
  it("still finds the milk beside the peanut butter", () => {
    expect(verdict(["2 tbsp peanut butter and 50 ml milk"], "milk")).toBe("excluded");
  });

  it("still finds the nut in the almond butter", () => {
    expect(verdict(["1 tbsp almond butter"], "tree-nut")).toBe("excluded");
  });

  it("still calls a jar opaque even when an exempt phrase was cut from the line", () => {
    // coconut milk is exempt for dairy; the curry paste in the same line is still a jar
    const reading = readAllergen(["400 ml coconut milk with 2 tbsp curry paste"], "milk");
    expect(reading.verdict).toBe("unknown");
  });
});
