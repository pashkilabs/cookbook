/**
 * What a child has actually said, counted — never what a child is like, inferred.
 *
 * ---------------------------------------------------------------------------
 * Observations, not claims
 * ---------------------------------------------------------------------------
 *
 * "Ada does not like fish" is a claim about a child. "Ada has rated 2 fish dishes, both low" is a
 * fact about the data, and it is honest at **any** sample size because whoever reads it can weigh
 * it themselves. Everything here produces the second kind, which is why the count is part of the
 * result rather than something a caller may choose to show.
 *
 * The danger this exists to avoid is concrete rather than theoretical. On the day it was written
 * the corpus held two child ratings — chicken n=1 mean 4, pork n=1 mean 2 — so a naive version
 * would have announced that Ada likes chicken and dislikes pork from one rating each. That is the
 * same failure as a confidently wrong recipe: fluent, specific, and standing on nothing.
 *
 * ---------------------------------------------------------------------------
 * Three outcomes, and the middle one is visible
 * ---------------------------------------------------------------------------
 *
 *   `pattern`     enough ratings to be worth saying, with the count
 *   `too-few`     some ratings, not enough — **shown, not hidden**
 *   `nothing`     no ratings at all in this dimension
 *
 * `too-few` renders. A silent absence is indistinguishable from a passing check, which is the
 * failure this project keeps meeting — and "we do not know yet" is a different message from "we
 * have nothing to show", especially to somebody wondering whether the feature works.
 *
 * The thresholds are deliberately unclever: a count, not a confidence interval. A statistic
 * nobody can check by counting rows is a statistic nobody will trust when it says something
 * surprising.
 */
export const ENOUGH_TO_SAY = 6;
export const ENOUGH_TO_MENTION = 3;

/** the dimensions a rating can be grouped by — every one is a column on `recipes` */
export type TasteDimension = "cuisine" | "principalProtein" | "dishForm" | "course";

export interface RatingObservation {
  memberId: string;
  dimension: TasteDimension;
  /** e.g. "thai", "chicken" — null when the recipe carries no value there */
  value: string | null;
  score: number;
}

export type TasteState = "pattern" | "too-few" | "nothing";

export interface TasteReading {
  dimension: TasteDimension;
  value: string;
  /** how many ratings this stands on — always shown, never implied by wording */
  count: number;
  /** mean score, to one decimal */
  mean: number;
  state: TasteState;
  /** "likes" and "avoids" only where `state` is `pattern`; otherwise null */
  leaning: "likes" | "avoids" | "mixed" | null;
}

const LIKES = 4;
const AVOIDS = 2.5;

/**
 * Group one member's ratings into readings, strongest evidence first.
 *
 * Sorted by count rather than by score: the reading standing on the most ratings is the one worth
 * reading first, and sorting by score would put the loudest single rating at the top, which is
 * exactly backwards.
 */
export function readTastes(observations: readonly RatingObservation[]): TasteReading[] {
  const buckets = new Map<string, { dimension: TasteDimension; value: string; scores: number[] }>();

  for (const observation of observations) {
    // a recipe with no cuisine says nothing about cuisine — it is not a "none" preference
    if (observation.value === null || observation.value === "") continue;
    const key = `${observation.dimension}:${observation.value}`;
    const bucket = buckets.get(key) ?? {
      dimension: observation.dimension,
      value: observation.value,
      scores: [],
    };
    bucket.scores.push(observation.score);
    buckets.set(key, bucket);
  }

  const readings: TasteReading[] = [];
  for (const bucket of buckets.values()) {
    const count = bucket.scores.length;
    const mean = Math.round((bucket.scores.reduce((a, b) => a + b, 0) / count) * 10) / 10;
    const state: TasteState = count >= ENOUGH_TO_SAY ? "pattern" : "too-few";
    readings.push({
      dimension: bucket.dimension,
      value: bucket.value,
      count,
      mean,
      state,
      // a leaning is a claim, so it is only made where the count carries it
      leaning:
        state !== "pattern" ? null : mean >= LIKES ? "likes" : mean <= AVOIDS ? "avoids" : "mixed",
    });
  }

  return readings.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * What to show for a member, when there is not enough for any pattern at all.
 *
 * Returned rather than left to the caller because the *absence* is the thing most likely to be
 * rendered as nothing, and rendering it as nothing is the bug.
 */
export function tasteSummary(readings: readonly TasteReading[], totalRatings: number): {
  state: TasteState;
  /** plain sentence, safe to render as-is */
  message: string;
} {
  if (totalRatings === 0) {
    return { state: "nothing", message: "No ratings yet — patterns start once a few are in." };
  }
  if (!readings.some((reading) => reading.state === "pattern")) {
    return {
      state: "too-few",
      message:
        `${totalRatings} rating${totalRatings === 1 ? "" : "s"} so far — ` +
        `too few to say anything yet.`,
    };
  }
  return { state: "pattern", message: "" };
}

/** "3 ratings" — the count in words, so no caller has to decide whether to show it */
export const evidence = (count: number) => `${count} rating${count === 1 ? "" : "s"}`;
