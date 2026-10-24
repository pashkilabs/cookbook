/**
 * Three readings of the same labels, reconciled field by field.
 *
 * ---------------------------------------------------------------------------
 * Why voting, when §61 says agreement is not correctness
 * ---------------------------------------------------------------------------
 *
 * `COMPONENT_TRUST` carries a measurement that three readings agreeing perfectly were still wrong
 * four times in eleven, and the explanation given there was that *"three runs of one model at
 * temperature zero on one prompt are not three independent opinions; they are one opinion sampled
 * three times."*
 *
 * That conclusion stands and its premise does not. Measured on the classifier, `temperature: 0`
 * on `openai/gpt-oss-120b` is **not** deterministic: the same recipe, the same prompt, three calls,
 * came back `[null, chicken, null]` and `[pork, seafood, seafood]`. If the samples were identical
 * a vote would buy nothing; they are not, so a vote buys the difference between a variance error
 * and a bias error — and only that. A dish the prompt is stably wrong about comes back wrong three
 * times out of three and is carried unanimously; a value missing from the enum is reached for
 * every time. **Consensus narrows the noise and cannot touch the bias**, which is why it is one of
 * three fixes here rather than the fix.
 *
 * So agreement is recorded and never gated on, exactly as §61 requires: a 2-of-3 stored as 2-of-3
 * tells the next reader which rows are soft, and the reverse claim is the sound one — low
 * agreement is evidence of trouble, high agreement is not evidence of correctness.
 *
 * ---------------------------------------------------------------------------
 * A tie declines
 * ---------------------------------------------------------------------------
 *
 * `consensusPartition` breaks a tie towards the smaller count, because inventing a split is the
 * worse failure. The same question has a measured answer here: of 61 proteins named in the real
 * library, **10 were wrong and all 10 were false positives** — a protein asserted where there was
 * none, or the nearest available one. Not a single recipe was wrongly declined. So when readings
 * disagree with no plurality, the answer is null: a dish shows as unclassified rather than as a
 * chapter that lies, and "Not sorted yet" is a thing a person can fix in one tap.
 *
 * A reading that declined is a **vote**, not an abstention. "This has no principal protein" is an
 * answer, and treating it as silence would let one reading naming a meat outvote two that read the
 * dish correctly.
 */

export interface LabelConsensus<K extends string> {
  /** what each field settled on */
  chosen: Record<K, string | null>;
  /** per field, the chosen value's share of the readings that came back, 0..1 */
  agreement: Record<K, number>;
  /** how many readings came back at all — a provider failure is dropped, never counted as a vote */
  readings: number;
}

/** a tally key that no normalised label can collide with, so "null" the string is not null */
const DECLINED = "\u0000declined";

const normaliseDefault = (value: string): string => value.trim().toLowerCase();

export function consensusLabels<K extends string>(
  readings: ReadonlyArray<Readonly<Record<K, string | null>> | null>,
  fields: readonly K[],
  normalise: (value: string) => string = normaliseDefault,
): LabelConsensus<K> | null {
  const live = readings.filter(
    (reading): reading is Readonly<Record<K, string | null>> => reading !== null,
  );
  if (live.length === 0) return null;

  const chosen: Record<string, string | null> = {};
  const agreement: Record<string, number> = {};

  for (const field of fields) {
    const tally = new Map<string, { value: string | null; votes: number }>();
    for (const reading of live) {
      const raw = reading[field];
      const key = raw === null ? DECLINED : normalise(raw);
      const seen = tally.get(key);
      // the first spelling wins the tie-break on spelling: "Italian" and "italian" are one vote
      // for one value, and the value stored is the one a model actually wrote
      if (seen) seen.votes += 1;
      else tally.set(key, { value: raw, votes: 1 });
    }

    let leader: string | null = null;
    let leading = 0;
    let tied = false;
    for (const entry of tally.values()) {
      if (entry.votes > leading) {
        leader = entry.value;
        leading = entry.votes;
        tied = false;
      } else if (entry.votes === leading) {
        tied = true;
      }
    }

    const settled = tied ? null : leader;
    chosen[field] = settled;
    /*
     * The share of readings that gave the *chosen* value, which is 0 when a tie declines and
     * nothing read it as declined. That reads oddly and is the honest number: no reading supports
     * the stored answer, and a row saying so is a row a person can be pointed at.
     */
    const supporting = settled === null ? (tally.get(DECLINED)?.votes ?? 0) : leading;
    agreement[field] = Math.round((supporting / live.length) * 100) / 100;
  }

  return {
    // one cast rather than a reduce with a per-key assertion: the keys are exactly `fields`
    chosen: chosen as Record<K, string | null>,
    agreement: agreement as Record<K, number>,
    readings: live.length,
  };
}
