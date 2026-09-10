import { describe, expect, it } from "vitest";
import { consensusPartition, partitionAgreement } from "../src/partitions.js";

const A = [{ from: 0, to: 3 }, { from: 4, to: 9 }];
const nearlyA = [{ from: 0, to: 4 }, { from: 5, to: 9 }];
const whole = [{ from: 0, to: 9 }];
const sixWay = [
  { from: 0, to: 1 }, { from: 2, to: 3 }, { from: 4, to: 5 },
  { from: 6, to: 6 }, { from: 7, to: 8 }, { from: 9, to: 9 },
];

describe("how much two readings say the same thing", () => {
  it("is 1 for identical readings", () => {
    expect(partitionAgreement(A, A)).toBe(1);
  });

  it("is high for a boundary off by one, which is the same reading of the recipe", () => {
    expect(partitionAgreement(A, nearlyA)).toBeGreaterThan(0.7);
  });

  it("is low for a different reading of the same ingredients", () => {
    expect(partitionAgreement(A, whole)).toBeLessThan(0.7);
  });

  /*
   * The symmetry is the point. A six-way split matches every component of a two-way split in one
   * direction — each small piece sits inside a big one — so an unsymmetrised score would let the
   * most over-split reading win by containing everything.
   */
  it("does not let an over-split reading win by matching everything", () => {
    const oneWayFlattering = partitionAgreement(sixWay, A);
    expect(oneWayFlattering).toBeLessThan(0.6);
    expect(partitionAgreement(sixWay, A)).toBe(partitionAgreement(A, sixWay));
  });

  it("is 0 against nothing", () => {
    expect(partitionAgreement(A, [])).toBe(0);
  });
});

describe("choosing the reading the others agree with", () => {
  it("picks the one two others resemble, not the outlier", () => {
    const result = consensusPartition([A, nearlyA, whole]);
    expect(result!.chosen).toEqual(A);
    expect(result!.readings).toBe(3);
  });

  it("reports agreement, because a partition nobody agreed on is not one to build on", () => {
    const agreed = consensusPartition([A, A, A])!;
    expect(agreed.agreement).toBe(1);
    const split = consensusPartition([A, whole, sixWay])!;
    expect(split.agreement).toBeLessThan(agreed.agreement);
  });

  /*
   * A declining run is not a vote. Counting it would drag agreement down for a recipe the other
   * readings agreed on perfectly — punishing a recipe for a run that said nothing about it.
   */
  it("ignores a run that declined rather than counting it as disagreement", () => {
    const withNull = consensusPartition([A, A, null])!;
    expect(withNull.agreement).toBe(1);
    expect(withNull.readings).toBe(2);
  });

  it("says how many readings survived, so one is not mistaken for certainty", () => {
    const alone = consensusPartition([A, null, null])!;
    expect(alone.agreement).toBe(1);
    expect(alone.readings).toBe(1);
  });

  it("returns null when every run declined, rather than inventing a partition", () => {
    expect(consensusPartition([null, null, null])).toBeNull();
    expect(consensusPartition([])).toBeNull();
  });
});
