import { describe, expect, it } from "vitest";
import { weekSummary } from "../lib/week-summary";

const WEEK = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
const meal = (date: string, time_minutes: number | null) => ({ date, recipe: { time_minutes } });

describe("the week's two summary figures", () => {
  it("counts days with a meal, not plan entries, so two dinners on Tuesday is still one Tuesday", () => {
    const summary = weekSummary([meal(WEEK[1]!, 20), meal(WEEK[1]!, 25), meal(WEEK[4]!, 40)], WEEK);
    expect(summary.daysWithAMeal).toBe(2);
  });

  it("sums the cook times when every planned recipe has one", () => {
    const summary = weekSummary([meal(WEEK[0]!, 35), meal(WEEK[1]!, 25)], WEEK);
    expect(summary.cookTime).toBe("1h total cook");
    expect(summary.partial).toBe(false);
  });

  it("says at least when a planned recipe has no time, rather than quietly understating", () => {
    const summary = weekSummary([meal(WEEK[0]!, 35), meal(WEEK[1]!, null)], WEEK);
    expect(summary.cookTime).toBe("at least 35m total cook");
    expect(summary.partial).toBe(true);
  });

  it("says at least even when every planned recipe is untimed, instead of claiming nothing to cook", () => {
    // regression-shaped: a floor of zero is the one case where "0m total cook" would read as a
    // measured fact about a full week, which is the silent-understatement failure at its worst
    const summary = weekSummary([meal(WEEK[0]!, null), meal(WEEK[2]!, null)], WEEK);
    expect(summary.cookTime).toBe("at least 0m total cook");
    expect(summary.daysWithAMeal).toBe(2);
  });

  it("states no total for an empty week, because zero minutes is a different claim from no meals", () => {
    const summary = weekSummary([], WEEK);
    expect(summary.cookTime).toBeNull();
    expect(summary.daysWithAMeal).toBe(0);
  });

  it("writes hours and minutes the way a person says them", () => {
    expect(weekSummary([meal(WEEK[0]!, 160)], WEEK).cookTime).toBe("2h 40m total cook");
    expect(weekSummary([meal(WEEK[0]!, 120)], WEEK).cookTime).toBe("2h total cook");
    expect(weekSummary([meal(WEEK[0]!, 45)], WEEK).cookTime).toBe("45m total cook");
  });

  it("ignores a meal on a date outside the week being shown", () => {
    // a plan entry moved to next week keeps its row; the summary must describe the week on screen
    const summary = weekSummary([meal("2026-11-02", 30)], WEEK);
    expect(summary.daysWithAMeal).toBe(0);
  });
});
