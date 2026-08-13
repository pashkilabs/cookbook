import { describe, expect, it } from "vitest";
import {
  addDays,
  addWeeks,
  dayAndMonth,
  isIsoDate,
  startOfWeek,
  todayIso,
  weekDays,
  weekLabel,
  weekdayName,
} from "../lib/week";

/**
 * Date arithmetic is where planners break, and always for the same reason: a local `Date`
 * silently shifts a calendar day. These pin the UTC behaviour so nobody "simplifies" it back.
 */
describe("startOfWeek", () => {
  it("returns the Monday of that week", () => {
    // 2026-08-12 is a Wednesday
    expect(startOfWeek("2026-08-12")).toBe("2026-08-10");
  });

  it("is idempotent on a Monday", () => {
    expect(startOfWeek("2026-08-10")).toBe("2026-08-10");
    expect(startOfWeek(startOfWeek("2026-08-12"))).toBe("2026-08-10");
  });

  it("treats Sunday as the end of the week, not the start", () => {
    // the trap in the other convention: a Sunday shop would belong to the week just gone
    expect(startOfWeek("2026-08-16")).toBe("2026-08-10");
    expect(weekdayName("2026-08-16")).toBe("Sunday");
  });

  it("crosses a month boundary", () => {
    expect(startOfWeek("2026-09-01")).toBe("2026-08-31");
  });

  it("crosses a year boundary", () => {
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
  });
});

describe("moving between weeks", () => {
  it("goes forward and back to where it started", () => {
    expect(addWeeks("2026-08-10", 1)).toBe("2026-08-17");
    expect(addWeeks("2026-08-10", -1)).toBe("2026-08-03");
    expect(addWeeks(addWeeks("2026-08-10", 5), -5)).toBe("2026-08-10");
  });

  it("does not lose or gain a day across a daylight-saving change", () => {
    // the UK moves clocks on 2026-10-25; a local-time implementation returns the 24th or 26th
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addWeeks("2026-10-19", 1)).toBe("2026-10-26");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });
});

describe("weekDays", () => {
  it("is seven consecutive days beginning at the week start", () => {
    const days = weekDays("2026-08-10");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-08-10");
    expect(days[6]).toBe("2026-08-16");
    expect(days.map(weekdayName)[0]).toBe("Monday");
    expect(days.map(weekdayName)[6]).toBe("Sunday");
  });
});

describe("labels", () => {
  it("collapses a week inside one month", () => {
    expect(weekLabel("2026-08-10")).toBe("10–16 August 2026");
  });

  it("spells out both months when a week straddles them", () => {
    expect(weekLabel("2026-08-31")).toBe("31 August – 6 September 2026");
  });

  it("spells out both years when a week straddles them", () => {
    expect(weekLabel("2026-12-28")).toBe("28 December 2026 – 3 January 2027");
  });

  it("names a day without consulting a locale", () => {
    expect(dayAndMonth("2026-08-10")).toBe("10 August");
    expect(weekdayName("2026-08-10")).toBe("Monday");
  });
});

describe("isIsoDate", () => {
  it("accepts a calendar day and rejects everything else", () => {
    expect(isIsoDate("2026-08-10")).toBe(true);
    expect(isIsoDate("2026-8-10")).toBe(false);
    expect(isIsoDate("2026-08-10T00:00:00Z")).toBe(false);
    expect(isIsoDate("not a date")).toBe(false);
    expect(isIsoDate(20260810)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it("rejects a day that does not exist", () => {
    // a query string is user input, and "2026-02-30" must not become 2026-03-02
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
  });
});

describe("todayIso", () => {
  it("is the calendar day in UTC", () => {
    expect(todayIso(new Date("2026-08-12T23:30:00Z"))).toBe("2026-08-12");
    expect(todayIso(new Date("2026-08-13T00:30:00Z"))).toBe("2026-08-13");
  });
});
