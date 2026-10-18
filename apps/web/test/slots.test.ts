import { describe, expect, it } from "vitest";
import { PLACED_COURSES, SLOTS, hourIn, isSlot, showsOnSlot, slotForHour } from "../lib/slots";

/** every value `recipes.course` permits, from the CHECK constraint, plus null */
const COURSES = ["breakfast", "starter", "main", "side", "dessert", "drink", "snack", null];

describe("which recipes a slot tab shows", () => {
  it("places every course the database permits, and null, on at least one tab", () => {
    /*
     * The check that matters. The spec's mapping listed five of the seven enum values and no
     * null, which dropped 24 of 66 real recipes — including 5 of the 10 rated ones — out of every
     * tab with nothing on screen saying so.
     */
    for (const course of COURSES) {
      const tabs = SLOTS.filter((slot) => showsOnSlot(course, slot));
      expect(tabs.length, `course ${String(course)} is on no tab`).toBeGreaterThan(0);
    }
  });

  it("leaves no course out of the mapping's own declared list", () => {
    for (const course of COURSES) expect(PLACED_COURSES).toContain(course);
  });

  it("shows breakfasts on the breakfast tab and nowhere else", () => {
    expect(SLOTS.filter((slot) => showsOnSlot("breakfast", slot))).toEqual(["breakfast"]);
  });

  it("shows the same recipes on lunch and dinner, because there is no lunch course", () => {
    // not an oversight: a household eats mains at both, and inventing a distinction the data
    // cannot support is the dead `lunch` chip again (§78)
    for (const course of COURSES) {
      expect(showsOnSlot(course, "lunch"), String(course)).toBe(showsOnSlot(course, "dinner"));
    }
  });

  it("puts an unclassified recipe on the main-meal tabs", () => {
    expect(showsOnSlot(null, "dinner")).toBe(true);
    expect(showsOnSlot(null, "lunch")).toBe(true);
    expect(showsOnSlot(null, "breakfast")).toBe(false);
    expect(showsOnSlot(null, "snack")).toBe(false);
  });

  it("puts a drink on the snack tab, which the spec's table forgot", () => {
    expect(showsOnSlot("drink", "snack")).toBe(true);
  });

  it("puts dessert with snacks rather than with mains", () => {
    expect(showsOnSlot("dessert", "snack")).toBe(true);
    expect(showsOnSlot("dessert", "dinner")).toBe(false);
  });
});

describe("which tab opens", () => {
  it("opens on breakfast before nine", () => {
    for (const hour of [0, 5, 8]) expect(slotForHour(hour), `${hour}:00`).toBe("breakfast");
  });

  it("opens on lunch from nine until one", () => {
    for (const hour of [9, 11, 12]) expect(slotForHour(hour), `${hour}:00`).toBe("lunch");
  });

  it("opens on dinner from one in the afternoon", () => {
    for (const hour of [13, 17, 19]) expect(slotForHour(hour), `${hour}:00`).toBe("dinner");
  });

  it("stays on dinner after eight, rather than rolling to tomorrow's breakfast", () => {
    // Steve's call: a screen called Today must not open on a meal that is not today's, and the
    // week owns tomorrow
    for (const hour of [20, 22, 23]) expect(slotForHour(hour), `${hour}:00`).toBe("dinner");
  });

  it("changes at exactly the stated boundaries", () => {
    expect(slotForHour(8)).toBe("breakfast");
    expect(slotForHour(9)).toBe("lunch");
    expect(slotForHour(12)).toBe("lunch");
    expect(slotForHour(13)).toBe("dinner");
  });
});

describe("the household's hour", () => {
  const at = (iso: string) => new Date(iso);

  it("reads the household's zone, not the machine's", () => {
    // 02:00 UTC is 21:00 the previous day in New York — dinner there, breakfast in UTC
    const moment = at("2026-10-18T02:00:00Z");
    expect(hourIn("America/New_York", moment)).toBe(22);
    expect(hourIn("UTC", moment)).toBe(2);
    expect(slotForHour(hourIn("America/New_York", moment))).toBe("dinner");
    expect(slotForHour(hourIn("UTC", moment))).toBe("breakfast");
  });

  it("gives midnight as 0 rather than 24", () => {
    // some locale/hour12 combinations render midnight as "24", which would skip every branch
    expect(hourIn("UTC", at("2026-10-18T00:30:00Z"))).toBe(0);
    expect(slotForHour(hourIn("UTC", at("2026-10-18T00:30:00Z")))).toBe("breakfast");
  });

  it("falls back to UTC on a zone it cannot read, exactly as todayIso does", () => {
    /*
     * A first draft asserted this throws, which matched the code and contradicted its own comment
     * — the `Number.isFinite` guard was dead because `Intl` throws at construction. Two functions
     * reading the same column on the same screen must not have two different fallbacks, or the
     * date and the tab end up in different zones.
     */
    expect(hourIn("Not/AZone", at("2026-10-18T17:00:00Z"))).toBe(17);
    expect(slotForHour(hourIn("Not/AZone", at("2026-10-18T17:00:00Z")))).toBe("dinner");
  });
});

describe("slot validation", () => {
  it("accepts the four and refuses anything else", () => {
    for (const slot of SLOTS) expect(isSlot(slot)).toBe(true);
    for (const bad of ["elevenses", "", "Dinner", null, 3, undefined]) expect(isSlot(bad)).toBe(false);
  });
});
