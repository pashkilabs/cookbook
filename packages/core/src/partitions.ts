/**
 * Agreeing on one partition out of several independent readings.
 *
 * ---------------------------------------------------------------------------
 * Why best-of-three is legitimate here and would not be at read time
 * ---------------------------------------------------------------------------
 *
 * Component inference scored 11, 12 and 19 of thirty on identical input. Re-rolling that at every
 * page view is incoherent — the same recipe splits differently on two visits. But running it
 * three times **once, at write**, and keeping the reading the others most agree with is a
 * different act: it spends three calls once to buy one stable answer, rather than spending one
 * call repeatedly to buy a different answer each time.
 *
 * ---------------------------------------------------------------------------
 * The medoid, not the mode
 * ---------------------------------------------------------------------------
 *
 * Exact agreement is too strict — two readings that differ by one ingredient at a boundary are
 * the same reading of the recipe, and demanding identity would declare disagreement on almost
 * everything. So the winner is the **medoid**: the reading that agrees most with the others,
 * measured by the same overlap the scorer uses.
 *
 * It always returns something, and it returns **how much** the readings agreed alongside it. A
 * low agreement is not a wrong answer — it is a partition nobody should build on yet, and saying
 * so is the difference between a confidence and a guess.
 */
export interface Partitioned {
  from: number;
  to: number;
}

const spread = (c: Partitioned) => {
  const out = new Set<number>();
  for (let i = c.from; i <= c.to; i += 1) out.add(i);
  return out;
};

const overlap = (a: Set<number>, b: Set<number>) => {
  let shared = 0;
  for (const n of a) if (b.has(n)) shared += 1;
  return shared / Math.max(a.size, b.size);
};

/**
 * How much two partitions say the same thing, 0..1.
 *
 * Each component in `a` is matched to its best unclaimed partner in `b` and the overlaps are
 * averaged, then the same is done the other way and the two averaged. **Symmetrised on purpose:**
 * a reading that splits a recipe into six pieces agrees well with a two-piece reading in one
 * direction and badly in the other, and calling that "agreement" would let an over-split answer
 * win by matching everything.
 */
export function partitionAgreement(
  a: readonly Partitioned[],
  b: readonly Partitioned[],
): number {
  if (a.length === 0 || b.length === 0) return 0;

  const oneWay = (from: readonly Partitioned[], to: readonly Partitioned[]) => {
    const taken = new Set<number>();
    let total = 0;
    for (const component of from) {
      const want = spread(component);
      let best = -1;
      let bestScore = 0;
      to.forEach((candidate, index) => {
        if (taken.has(index)) return;
        const score = overlap(want, spread(candidate));
        if (score > bestScore) {
          bestScore = score;
          best = index;
        }
      });
      if (best >= 0) taken.add(best);
      total += bestScore;
    }
    return total / from.length;
  };

  return (oneWay(a, b) + oneWay(b, a)) / 2;
}

export interface Consensus<T extends Partitioned> {
  /** the reading the others agreed with most */
  chosen: T[];
  /** its mean agreement with the other readings, 0..1 */
  agreement: number;
  /** how many readings were available to compare */
  readings: number;
}

/**
 * Pick the reading the others most agree with.
 *
 * Nulls are dropped before comparing — a run that declined is not a vote for anything, and
 * counting it would drag agreement down for a recipe the others read identically. But the count
 * of *surviving* readings is returned, because one reading agreeing with nothing is not the same
 * as three agreeing perfectly, and an agreement of 1 from a single reading would otherwise look
 * like certainty.
 */
export function consensusPartition<T extends Partitioned>(
  readings: ReadonlyArray<readonly T[] | null>,
): Consensus<T> | null {
  const live = readings.filter((r): r is readonly T[] => Array.isArray(r) && r.length > 0);
  if (live.length === 0) return null;
  if (live.length === 1) return { chosen: [...live[0]!], agreement: 1, readings: 1 };

  let best = 0;
  let bestScore = -1;
  live.forEach((candidate, index) => {
    let total = 0;
    live.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      total += partitionAgreement(candidate, other);
    });
    const mean = total / (live.length - 1);
    if (mean > bestScore) {
      bestScore = mean;
      best = index;
    }
  });

  return { chosen: [...live[best]!], agreement: Math.round(bestScore * 100) / 100, readings: live.length };
}
