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
 * Three corrections, all found by review after the first version shipped
 * ---------------------------------------------------------------------------
 *
 * The first version claimed symmetrising the score was enough to stop an over-split reading
 * winning. **It is not, and the counter-example is the commonest thing an unstable model does.**
 * When two readings disagree about where one boundary sits, a third reading carrying BOTH
 * boundaries agrees with each of them more than they agree with each other — so the refinement
 * wins, and it wins carrying a *higher* agreement than the two readings that actually concurred.
 * Concretely, before the fix:
 *
 *     X = 0-4 | 5-9        Y = 0-1 | 2-9        Z = 0-1 | 2-4 | 5-9
 *     X~Y 0.5125           X~Z 0.6333           Y~Z 0.6354      →  Z stored, agreement 0.63
 *
 * Two runs said the recipe has two components and the three-component hedge was kept. That is
 * exactly the failure §60 calls the worst available — "inventing a split that is not there is
 * worse than missing one: somebody may build a meal on it" — and the stored confidence pointed
 * the wrong way, so no downstream threshold could have caught it.
 *
 * The fix is not a better similarity score. It is to **decide the component count first, by
 * counting readings rather than by measuring overlap**, and only then pick among the readings
 * that agree on it. Two votes for two components settle that the answer has two.
 *
 * The other two corrections share one root: the assignment was greedy, so an earlier small
 * component could claim the partner a later large one overlapped far more, and be permanently
 * starved by the `taken` set. That understated agreement on around half of realistic pairs, and
 * it made the score depend on **the order a reading happened to list its components** — the same
 * partition listed largest-first scored 0.6667 where smallest-first scored 0.4722. A difference in
 * listing order is not a difference in reading. The assignment is exact now; with components
 * capped at eight by the schema, an exact matching costs nothing.
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
 * The best total pairing of `rows` onto `cols`, exactly.
 *
 * Bitmask dynamic programming over the columns: at most 8 components by schema, so this is
 * 8 x 256 states and finishes instantly. Greedy was the bug — it is order-dependent and can
 * starve the pairing that matters — and no approximation is worth defending when the exact
 * answer is this cheap.
 */
function bestAssignment(scores: number[][]): number {
  const rows = scores.length;
  const cols = rows > 0 ? scores[0]!.length : 0;
  if (rows === 0 || cols === 0) return 0;

  const memo = new Map<number, number>();
  const walk = (row: number, used: number): number => {
    if (row === rows) return 0;
    const key = row * (1 << cols) + used;
    const seen = memo.get(key);
    if (seen !== undefined) return seen;

    // a row may go unpaired: a reading with more components than the other simply has some
    // that match nothing, and forcing a pairing would invent agreement
    let best = walk(row + 1, used);
    for (let col = 0; col < cols; col += 1) {
      if (used & (1 << col)) continue;
      best = Math.max(best, scores[row]![col]! + walk(row + 1, used | (1 << col)));
    }
    memo.set(key, best);
    return best;
  };
  return walk(0, 0);
}

/**
 * How much two partitions say the same thing, 0..1.
 *
 * Symmetrised, because a reading that splits a recipe into six pieces matches every component of
 * a two-piece reading in one direction and badly in the other. Symmetry alone is **not** enough
 * to stop an over-split reading winning the medoid — see the header — but it is still needed, or
 * a finer reading would score 1.0 against anything that contains it.
 */
export function partitionAgreement(
  a: readonly Partitioned[],
  b: readonly Partitioned[],
): number {
  if (a.length === 0 || b.length === 0) return 0;

  const scores = a.map((x) => {
    const want = spread(x);
    return b.map((y) => overlap(want, spread(y)));
  });

  const forward = bestAssignment(scores) / a.length;
  const backward =
    bestAssignment(scores[0]!.map((_, col) => scores.map((row) => row[col]!))) / b.length;
  return (forward + backward) / 2;
}

export interface Consensus<T extends Partitioned> {
  /** the reading the others agreed with most, among those agreeing on the component count */
  chosen: T[];
  /** its mean agreement with the other readings of the same count, 0..1 */
  agreement: number;
  /** how many readings survived to be compared — one is not consensus, however self-consistent */
  readings: number;
  /** how many readings agreed on the component count that won */
  agreedOnCount: number;
}

/**
 * Pick the reading the others most agree with.
 *
 * **The component count is decided by voting, not by overlap.** Two readings saying "two
 * components" settle that the answer has two, and the medoid is then chosen among those. Without
 * this a hedged reading carrying every boundary either side proposed wins on similarity while
 * disagreeing with both — inventing a split, which is the worst output this feature has.
 *
 * A tie on votes goes to the **smaller** count, because under-splitting is the safer failure: an
 * under-split component is a larger piece of a real recipe, where an over-split one is a piece
 * that was never a component at all.
 *
 * Nulls are dropped before comparing — a run that declined is not a vote — but the surviving
 * count is returned, because one reading agreeing with nothing is not three agreeing perfectly.
 */
export function consensusPartition<T extends Partitioned>(
  readings: ReadonlyArray<readonly T[] | null>,
): Consensus<T> | null {
  const live = readings.filter((r): r is readonly T[] => Array.isArray(r) && r.length > 0);
  if (live.length === 0) return null;
  if (live.length === 1) {
    return { chosen: [...live[0]!], agreement: 1, readings: 1, agreedOnCount: 1 };
  }

  const votes = new Map<number, number>();
  for (const reading of live) votes.set(reading.length, (votes.get(reading.length) ?? 0) + 1);

  let winningCount = Infinity;
  let mostVotes = 0;
  for (const [count, tally] of votes) {
    // more votes wins; a tie goes to the smaller count, because inventing a split is worse
    if (tally > mostVotes || (tally === mostVotes && count < winningCount)) {
      mostVotes = tally;
      winningCount = count;
    }
  }

  const candidates = live.filter((r) => r.length === winningCount);

  let best = 0;
  let bestScore = -1;
  candidates.forEach((candidate, index) => {
    let total = 0;
    let compared = 0;
    // scored against every surviving reading, including those of another count — a candidate
    // that also resembles the readings it outvoted is the better representative of all of them
    live.forEach((other) => {
      if (other === candidate) return;
      total += partitionAgreement(candidate, other);
      compared += 1;
    });
    const mean = compared === 0 ? 1 : total / compared;
    if (mean > bestScore) {
      bestScore = mean;
      best = index;
    }
  });

  return {
    chosen: [...candidates[best]!],
    agreement: Math.round(bestScore * 100) / 100,
    readings: live.length,
    agreedOnCount: mostVotes,
  };
}
