import { describe, expect, it } from "vitest";
import { leaderboard } from "../lib/leaderboard";

const MEMBERS = [
  { id: "ada", displayName: "Ada" },
  { id: "paige", displayName: "Paige" },
  { id: "hazel", displayName: "Hazel" },
  { id: "noah", displayName: "Noah" },
  { id: "steve", displayName: "Steve" },
];
const recipe = (id: string, title: string, timesMade = 0) => ({ id, title, timesMade });
const rate = (recipeId: string, memberId: string, score: number) => ({ recipeId, memberId, score });

describe("what the household likes, as counts of people", () => {
  it("counts members who rated it 4 or more, over members who rated at all", () => {
    const rows = leaderboard(
      [recipe("r1", "Easy Fried Rice")],
      [rate("r1", "ada", 5), rate("r1", "paige", 4), rate("r1", "hazel", 3)],
      MEMBERS,
    );
    expect(rows[0]).toMatchObject({ liked: 2, rated: 3, untried: 2 });
  });

  it("names a member who rated below 4, with the score they actually gave", () => {
    // the spec said "<Name> said no"; the lowest score anybody here has given is a 3, and calling
    // a 3 a refusal is a verdict the data does not support
    const rows = leaderboard([recipe("r1", "Baja Fish Tacos")], [rate("r1", "hazel", 3)], MEMBERS);
    expect(rows[0]!.lukewarm).toEqual([{ name: "Hazel", score: 3 }]);
  });

  it("leaves an unrated recipe off entirely rather than ranking it last", () => {
    // 10 of 66 recipes have any rating, so ranking the rest would be a wall of "5 haven't tried it"
    const rows = leaderboard(
      [recipe("rated", "Rated"), recipe("silent", "Never rated")],
      [rate("rated", "ada", 5)],
      MEMBERS,
    );
    expect(rows.map((row) => row.id)).toEqual(["rated"]);
  });

  it("treats untried as untried, not as disliked", () => {
    const rows = leaderboard([recipe("r1", "Hibachi")], [rate("r1", "ada", 5), rate("r1", "paige", 4)], MEMBERS);
    expect(rows[0]).toMatchObject({ liked: 2, untried: 3, lukewarm: [] });
  });

  it("orders by people who liked it, then by times made, then by title", () => {
    const rows = leaderboard(
      [recipe("a", "Agreed once", 1), recipe("b", "Made often", 9), recipe("c", "Popular")],
      [
        rate("a", "ada", 5),
        rate("b", "ada", 5),
        rate("c", "ada", 5),
        rate("c", "paige", 5),
      ],
      MEMBERS,
    );
    expect(rows.map((row) => row.title)).toEqual(["Popular", "Made often", "Agreed once"]);
  });

  it("counts a member once even if two rating rows exist for them", () => {
    // regression-shaped: the one-per-member rule is a partial unique index, not something this
    // function can lean on — counting rows would report "6 of 5 liked it"
    const rows = leaderboard(
      [recipe("r1", "Twice rated")],
      [rate("r1", "ada", 4), rate("r1", "ada", 5)],
      MEMBERS,
    );
    expect(rows[0]).toMatchObject({ liked: 1, rated: 1, untried: 4 });
  });

  it("ignores a rating from somebody no longer in the household", () => {
    // ratings outlive a member leaving, and an unnamed "somebody rated it 3" is exactly the
    // unverifiable figure the count-of-people rule exists to prevent
    const rows = leaderboard([recipe("r1", "Old favourite")], [rate("r1", "departed", 5)], MEMBERS);
    expect(rows).toEqual([]);
  });

  it("never reports a negative untried count when more people rated than are members", () => {
    const rows = leaderboard([recipe("r1", "Odd")], [rate("r1", "ada", 5), rate("r1", "paige", 5)], [MEMBERS[0]!]);
    expect(rows[0]!.untried).toBe(0);
  });

  it("exposes no score, average or rank anywhere in its output", () => {
    // §71 and §75: the only figures are counts of people. A single number would be a confidence
    // signal this app has twice measured itself as not having.
    const rows = leaderboard([recipe("r1", "X", 3)], [rate("r1", "ada", 5), rate("r1", "hazel", 3)], MEMBERS);
    const keys = Object.keys(rows[0]!);
    expect(keys).not.toContain("average");
    expect(keys).not.toContain("score");
    expect(keys).not.toContain("rank");
    expect(keys).not.toContain("percentage");
  });

  it("says nothing at all when nobody has rated anything", () => {
    expect(leaderboard([recipe("a", "A"), recipe("b", "B")], [], MEMBERS)).toEqual([]);
  });
});
