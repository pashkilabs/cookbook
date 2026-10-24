import { describe, expect, it } from "vitest";
import { consensusLabels } from "../src/consensus.js";

const FIELDS = ["course", "cuisine", "principalProtein"] as const;

const reading = (
  course: string | null,
  cuisine: string | null,
  principalProtein: string | null,
) => ({ course, cuisine, principalProtein });

describe("three readings of one recipe", () => {
  it("takes the answer two of three readings gave", () => {
    const agreed = consensusLabels(
      [reading("main", null, "pork"), reading("main", null, "seafood"), reading("main", null, "seafood")],
      FIELDS,
    );
    expect(agreed?.chosen.principalProtein).toBe("seafood");
    expect(agreed?.agreement.principalProtein).toBe(0.67);
    expect(agreed?.readings).toBe(3);
  });

  it("records a unanimous answer as unanimous, so a soft row is distinguishable from a firm one", () => {
    const agreed = consensusLabels(
      [reading("main", null, "pork"), reading("main", null, "pork"), reading("main", null, "pork")],
      FIELDS,
    );
    expect(agreed?.agreement).toEqual({ course: 1, cuisine: 1, principalProtein: 1 });
  });

  it("declines when the readings disagree three ways, rather than picking one", () => {
    const agreed = consensusLabels(
      [reading("main", null, "pork"), reading("main", null, "beef"), reading("main", null, "chicken")],
      FIELDS,
    );
    // all 10 errors measured in the real library were false positives: asserting is the costly way
    // to be wrong, so no plurality means no answer
    expect(agreed?.chosen.principalProtein).toBeNull();
    expect(agreed?.agreement.principalProtein).toBe(0);
  });

  it("counts a declining reading as a vote, not as silence", () => {
    const agreed = consensusLabels(
      [reading("dessert", null, null), reading("dessert", null, null), reading("dessert", null, "pork")],
      FIELDS,
    );
    expect(agreed?.chosen.principalProtein).toBeNull();
    expect(agreed?.agreement.principalProtein).toBe(0.67);
  });

  it("settles each field on its own, because one field's noise is not another's", () => {
    const agreed = consensusLabels(
      [reading("main", "Thai", "chicken"), reading("side", "Thai", "chicken"), reading("dessert", "Thai", "chicken")],
      FIELDS,
    );
    expect(agreed?.chosen).toEqual({ course: null, cuisine: "Thai", principalProtein: "chicken" });
    expect(agreed?.agreement).toEqual({ course: 0, cuisine: 1, principalProtein: 1 });
  });

  it("reads two spellings of one cuisine as one vote, and keeps the spelling written", () => {
    const agreed = consensusLabels(
      [reading("main", "Italian", null), reading("main", "italian", null), reading("main", "Thai", null)],
      FIELDS,
    );
    expect(agreed?.chosen.cuisine).toBe("Italian");
    expect(agreed?.agreement.cuisine).toBe(0.67);
  });

  it("drops a reading that never came back instead of counting it as disagreement", () => {
    const agreed = consensusLabels(
      [reading("main", null, "beef"), null, null],
      FIELDS,
    );
    expect(agreed?.chosen.principalProtein).toBe("beef");
    expect(agreed?.readings).toBe(1);
    // the share is honest — one reading agreed with itself; whether that is enough is the
    // caller's rule, not this function's
    expect(agreed?.agreement.principalProtein).toBe(1);
  });

  it("has nothing to say when every reading failed", () => {
    expect(consensusLabels([null, null, null], FIELDS)).toBeNull();
  });

  it("does not confuse the string 'null' with a declining reading", () => {
    const agreed = consensusLabels(
      [reading("main", null, null), reading("main", "null", null), reading("main", "null", null)],
      FIELDS,
    );
    expect(agreed?.chosen.cuisine).toBe("null");
    expect(agreed?.agreement.cuisine).toBe(0.67);
  });
});
