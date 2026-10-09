import { describe, expect, it } from "vitest";
import { readForHousehold, readForMember, type InferredPreference, type StatedPreference } from "../src/index.js";

const recipe = { ingredients: ["mushroom", "cream"], cuisine: "italian", dishForm: "pasta" };
const stated = (over: Partial<StatedPreference>): StatedPreference => ({
  memberId: "ada", stance: "dislike", subjectKind: "ingredient", subject: "mushroom", ...over,
});
const guessed = (over: Partial<InferredPreference>): InferredPreference => ({
  memberId: "ada", stance: "like", subjectKind: "ingredient", subject: "mushroom", ...over,
});

describe("stated beats inferred, and nothing blends", () => {
  it("lets a stated dislike override an inferred like", () => {
    // the whole point: an inference nobody can correct goes wrong permanently
    const reading = readForMember("ada", recipe, [stated({})], [guessed({})]);
    expect(reading.outcome).toBe("disliked");
    expect(reading.because).toBe("mushroom");
  });

  it("falls back to the inference only when nothing was stated", () => {
    expect(readForMember("ada", recipe, [], [guessed({})]).outcome).toBe("inferred-like");
  });

  it("marks an inferred dislike as inferred, so a screen can say which it is", () => {
    const reading = readForMember("ada", recipe, [], [guessed({ stance: "dislike" })]);
    expect(reading.outcome).toBe("inferred-dislike");
  });

  it("names the subject that decided it rather than asserting a verdict", () => {
    const reading = readForMember("ada", recipe, [stated({ subjectKind: "cuisine", subject: "italian" })], []);
    expect(reading.because).toBe("italian");
  });

  it("does not let one member's statement speak for another", () => {
    expect(readForMember("bo", recipe, [stated({})], []).outcome).toBe("nothing-said");
  });

  it("puts a stated dislike ahead of a stated like on a different subject", () => {
    // no arithmetic: liking pasta does not offset saying no to mushrooms
    const reading = readForMember(
      "ada", recipe,
      [stated({}), stated({ stance: "like", subjectKind: "dish_form", subject: "pasta" })],
      [],
    );
    expect(reading.outcome).toBe("disliked");
  });
});

describe("an allergy excludes and is not reachable through preference matching", () => {
  it("reports excluded whatever has been stated", () => {
    const reading = readForMember(
      "ada", recipe,
      [stated({ stance: "like", subject: "mushroom" })],
      [],
      { allergen: "milk", verdict: "excluded" },
    );
    expect(reading.outcome).toBe("excluded");
    expect(reading.allergen).toEqual({ allergen: "milk", verdict: "excluded" });
  });

  it("carries the verdict, so an unknown reads differently from a definite match", () => {
    const reading = readForMember("ada", recipe, [], [], { allergen: "milk", verdict: "unknown" });
    expect(reading.allergen?.verdict).toBe("unknown");
  });
});

describe("the only number is a count of people", () => {
  it("counts the members a recipe suits, stated and inferred alike", () => {
    const household = readForHousehold(
      ["ada", "bo", "cy"], recipe,
      [stated({ memberId: "ada", stance: "like" })],
      [guessed({ memberId: "bo" })],
    );
    expect(household.satisfies).toBe(2);
  });

  it("does not count an exclusion as a dissatisfaction — it removes the recipe", () => {
    const household = readForHousehold(
      ["ada", "bo"], recipe, [stated({ memberId: "bo", stance: "like" })], [],
      new Map([["ada", { allergen: "milk" as const, verdict: "excluded" as const }]]),
    );
    expect(household.excludedFor).toEqual(["ada"]);
    expect(household.satisfies).toBe(1);
  });

  it("separates stated objections from inferred ones in the household view", () => {
    const household = readForHousehold(
      ["ada", "bo"], recipe,
      [stated({ memberId: "ada" })],
      [guessed({ memberId: "bo", stance: "dislike" })],
    );
    expect(household.dislikedBy).toEqual(["ada"]);
  });

  /*
   * The empty state, which is the month-one case: 26 ratings across 7 recipes, so almost every
   * recipe reaches this. "Nobody has said" invites stating something; "nobody objects" does not,
   * and a screen that cannot tell them apart shows the second when it means the first.
   */
  it("distinguishes nobody having said anything from nobody objecting", () => {
    const silent = readForHousehold(["ada", "bo"], recipe, [], []);
    expect(silent.nobodyHasSaid).toBe(true);
    expect(silent.satisfies).toBe(0);
    expect(silent.dislikedBy).toEqual([]);

    const approved = readForHousehold(["ada", "bo"], recipe, [stated({ stance: "like" })], []);
    expect(approved.nobodyHasSaid).toBe(false);
  });
});
