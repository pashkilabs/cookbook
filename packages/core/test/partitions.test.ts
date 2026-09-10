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

describe("the three defects review found after the first version shipped", () => {
  /*
   * The first version's own comment claimed symmetry stopped an over-split reading winning. It
   * did not, and the counter-example is the commonest thing an unstable model does: two readings
   * disagree about one boundary, a third carries BOTH, and the hedge agrees with each of them
   * more than they agree with each other. It won, and it won with a HIGHER stored confidence than
   * the two that concurred — so no downstream threshold could have caught it.
   *
   * The original test only checked partitionAgreement(sixWay, A) < 0.6 and its symmetry. It never
   * put an over-split reading through consensusPartition, and never used two coarse readings that
   * disagreed with each other, which is the only arrangement where the failure appears.
   */
  it("regression: keeps the count two readings voted for, not the hedge that spans both", () => {
    const X = [{ from: 0, to: 4 }, { from: 5, to: 9 }];
    const Y = [{ from: 0, to: 1 }, { from: 2, to: 9 }];
    const bothBoundaries = [{ from: 0, to: 1 }, { from: 2, to: 4 }, { from: 5, to: 9 }];

    // the hedge still out-scores each coarse reading pairwise — that is the trap
    expect(partitionAgreement(X, bothBoundaries)).toBeGreaterThan(partitionAgreement(X, Y));
    expect(partitionAgreement(Y, bothBoundaries)).toBeGreaterThan(partitionAgreement(X, Y));

    const result = consensusPartition([X, Y, bothBoundaries])!;
    expect(result.chosen).toHaveLength(2);
    expect(result.agreedOnCount).toBe(2);
  });

  it("regression: the same trap at four components against a five-component hedge", () => {
    const X = [{ from: 0, to: 0 }, { from: 1, to: 2 }, { from: 3, to: 4 }, { from: 5, to: 9 }];
    const Y = [{ from: 0, to: 0 }, { from: 1, to: 2 }, { from: 3, to: 6 }, { from: 7, to: 9 }];
    const hedge = [
      { from: 0, to: 0 }, { from: 1, to: 2 }, { from: 3, to: 4 }, { from: 5, to: 6 }, { from: 7, to: 9 },
    ];
    expect(consensusPartition([X, Y, hedge])!.chosen).toHaveLength(4);
  });

  // under-splitting is the safer failure, so a tie on votes goes to the smaller count
  it("breaks a tie on component count toward fewer, never toward more", () => {
    const two = [{ from: 0, to: 4 }, { from: 5, to: 9 }];
    const three = [{ from: 0, to: 2 }, { from: 3, to: 5 }, { from: 6, to: 9 }];
    expect(consensusPartition([two, three])!.chosen).toHaveLength(2);
  });

  /*
   * The assignment was greedy: an earlier small component claimed the partner a later large one
   * overlapped far more, and the `taken` set starved it permanently. That understated agreement,
   * so a recipe whose runs DID agree was recorded as unstable.
   */
  it("regression: a small component no longer starves a large one of its partner", () => {
    expect(
      partitionAgreement([{ from: 0, to: 1 }, { from: 2, to: 9 }],
                         [{ from: 0, to: 1 }, { from: 2, to: 3 }, { from: 4, to: 9 }]),
    ).toBeCloseTo(0.7292, 3);
    expect(
      partitionAgreement([{ from: 0, to: 0 }, { from: 1, to: 8 }], [{ from: 0, to: 8 }]),
    ).toBeCloseTo(0.6667, 3);
  });

  /*
   * Greedy was order-dependent, so the score depended on the order a run happened to LIST its
   * components — which is not a difference in reading at all. Nothing normalised it: coversExactly
   * accepts an unsorted array and the model's order is passed straight through.
   */
  it("regression: listing the same partition in a different order scores the same", () => {
    const whole = [{ from: 0, to: 8 }];
    const smallFirst = [{ from: 0, to: 0 }, { from: 1, to: 8 }];
    const largeFirst = [{ from: 1, to: 8 }, { from: 0, to: 0 }];
    expect(partitionAgreement(smallFirst, whole)).toBe(partitionAgreement(largeFirst, whole));
  });

  it("regression: a reordered reading does not change which partition is stored", () => {
    const A = [{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 2, to: 8 }];
    const B = [{ from: 0, to: 0 }, { from: 1, to: 2 }, { from: 3, to: 8 }];
    const C = [{ from: 0, to: 0 }, { from: 1, to: 6 }, { from: 7, to: 8 }];
    const forward = consensusPartition([A, B, C])!;
    const reversed = consensusPartition([[...A].reverse(), B, C])!;
    expect(reversed.chosen.map((c) => `${c.from}-${c.to}`).sort())
      .toEqual(forward.chosen.map((c) => `${c.from}-${c.to}`).sort());
  });

  /*
   * A run lost to a provider error is dropped as a non-vote, so two surviving runs that concur
   * stored the same 1.0 as three would — the fewer runs answered, the more confident the row
   * looked. The count has to travel with the number or it cannot be read honestly.
   */
  it("regression: reports how many readings survived, not just how much they agreed", () => {
    const A = [{ from: 0, to: 4 }, { from: 5, to: 9 }];
    expect(consensusPartition([A, A, null])!.readings).toBe(2);
    expect(consensusPartition([A, A, A])!.readings).toBe(3);
    expect(consensusPartition([A, null, null])!.readings).toBe(1);
  });
});
