import { describe, expect, it } from "vitest";
import { readTastes, tasteSummary, evidence, type RatingObservation } from "../src/tastes.js";

const rate = (value: string | null, score: number, dimension = "principalProtein" as const): RatingObservation =>
  ({ memberId: "ada", dimension, value, score });

describe("reading what a child has actually said", () => {
  // the state of the corpus the day this was written: one rating each way, which a naive
  // version would have announced as "Ada likes chicken and dislikes pork"
  it("makes no claim from one rating, and says so rather than staying silent", () => {
    const readings = readTastes([rate("chicken", 4), rate("pork", 2)]);
    expect(readings.every((r) => r.state === "too-few")).toBe(true);
    expect(readings.every((r) => r.leaning === null)).toBe(true);
  });

  it("carries the count on every reading, so three and thirty cannot look alike", () => {
    const [reading] = readTastes([rate("fish", 2), rate("fish", 1), rate("fish", 2)]);
    expect(reading!.count).toBe(3);
  });

  it("only leans once there are enough ratings to lean on", () => {
    const six = Array.from({ length: 6 }, () => rate("chicken", 5));
    expect(readTastes(six)[0]!.leaning).toBe("likes");
    const five = Array.from({ length: 5 }, () => rate("chicken", 5));
    expect(readTastes(five)[0]!.leaning).toBeNull();
    expect(readTastes(five)[0]!.state).toBe("too-few");
  });

  it("says avoids only for a low mean, and mixed when opinion is split", () => {
    const low = Array.from({ length: 6 }, () => rate("fish", 2));
    expect(readTastes(low)[0]!.leaning).toBe("avoids");
    const split = [1, 5, 1, 5, 1, 5].map((score) => rate("fish", score));
    expect(readTastes(split)[0]!.leaning).toBe("mixed");
  });

  it("ignores a recipe with no value in that dimension — it is not a 'none' preference", () => {
    expect(readTastes([rate(null, 5), rate("", 5)])).toEqual([]);
  });

  it("puts the best-evidenced reading first, not the loudest", () => {
    const readings = readTastes([
      rate("lamb", 5),
      ...Array.from({ length: 4 }, () => rate("chicken", 3)),
    ]);
    expect(readings[0]!.value).toBe("chicken");
  });
});

describe("the summary, whose whole job is to be visible when there is nothing", () => {
  it("distinguishes no ratings from too few — a silent absence reads as a pass", () => {
    expect(tasteSummary([], 0).state).toBe("nothing");
    expect(tasteSummary(readTastes([rate("chicken", 4)]), 1).state).toBe("too-few");
  });

  it("gives a sentence for both, rather than leaving the caller to render nothing", () => {
    expect(tasteSummary([], 0).message).toMatch(/No ratings yet/);
    expect(tasteSummary(readTastes([rate("chicken", 4)]), 1).message).toMatch(/too few to say/);
  });

  it("counts one rating in the singular, because 1 ratings reads as a bug", () => {
    expect(evidence(1)).toBe("1 rating");
    expect(evidence(3)).toBe("3 ratings");
  });
});

describe("course is counted but never said out loud", () => {
  const rated = (dimension: RatingObservation["dimension"], value: string, scores: number[]) =>
    scores.map((score) => ({ memberId: "m", dimension, value, score }));

  it("still groups course, because the count is real", () => {
    // excluded from what is *said*, not from what is known — a future screen may want it
    const readings = readTastes(rated("course", "main", [5, 5, 4, 5, 4, 5]));
    expect(readings).toHaveLength(1);
    expect(readings[0]?.state).toBe("pattern");
  });

  it("does not let a course pattern stand in for something worth reading", () => {
    /*
     * "Ada rates main highly" is true, unfalsifiable and useless — almost every dinner is a
     * main, so it says a child likes dinner. It also sorts first, because it has the most
     * ratings behind it, so the one screen where this work comes back led with its emptiest
     * sentence. `warningsFor` already excluded course by quietly omitting it from a list.
     */
    const readings = readTastes(rated("course", "main", [5, 5, 4, 5, 4, 5]));
    const summary = tasteSummary(readings, 6);
    expect(summary.state).toBe("too-few");
    expect(summary.message).toContain("too few to say");
  });

  it("says something as soon as a telling dimension has the ratings", () => {
    const readings = readTastes([
      ...rated("course", "main", [5, 5, 4, 5, 4, 5]),
      ...rated("principalProtein", "fish", [1, 2, 1, 2, 1, 2]),
    ]);
    expect(tasteSummary(readings, 12).state).toBe("pattern");
  });
});
