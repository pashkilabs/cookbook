import { describe, expect, it } from "vitest";
import {
  DWELL_MS,
  GESTURE,
  autoScrollVelocity,
  confirmDrop,
  dropTargetAt,
  dwell,
  gestureIntent,
  noDwell,
  type RowBox,
} from "../lib/drag-geometry";

/*
 * A real week, in document coordinates, with a realistic irregularity: Wednesday is open, so it
 * is 200px tall beside six 72px rows, and there is an 8px gap between every pair. Equal-height
 * rows would make several of these tests pass for the wrong reason.
 */
const GAP = 8;
const WEEK: RowBox[] = (() => {
  const dates = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
  const rows: RowBox[] = [];
  let top = 420;
  for (const date of dates) {
    const height = date === "2026-10-21" ? 200 : 72;
    rows.push({ date, top, bottom: top + height });
    top += height + GAP;
  }
  return rows;
})();

const WED = WEEK[2]!;
const THU = WEEK[3]!;

describe("which day a drop lands on", () => {
  it("claims the pixel at a row's top and not the one at its bottom", () => {
    // the off-by-one that would put a meal on the day above or below, every time
    expect(dropTargetAt(THU.top, WEEK)?.date).toBe(THU.date);
    expect(dropTargetAt(THU.bottom, WEEK)?.date).not.toBe(THU.date);
    expect(dropTargetAt(THU.bottom - 1, WEEK)?.date).toBe(THU.date);
  });

  it("gives two adjacent rows no pixel in common", () => {
    // if a boundary pixel were claimed twice the answer would depend on row order, which is the
    // kind of bug that only shows up after somebody reorders an array
    for (const y of [WED.bottom - 1, WED.bottom, THU.top - 1, THU.top]) {
      const hits = WEEK.filter((row) => y >= row.top && y < row.bottom);
      expect(hits.length).toBeLessThanOrEqual(1);
    }
  });

  it("drops nothing in the gap between two rows", () => {
    // the near-miss, which is the most common release position of all. Snapping to the nearest
    // would silently pick a side, and picking a side is the failure that writes the wrong day.
    const middleOfGap = WED.bottom + GAP / 2;
    expect(dropTargetAt(middleOfGap, WEEK)).toBeNull();
    for (let y = WED.bottom; y < THU.top; y += 1) expect(dropTargetAt(y, WEEK)).toBeNull();
  });

  it("drops nothing above the first row or below the last", () => {
    const first = WEEK[0]!;
    const last = WEEK[WEEK.length - 1]!;
    expect(dropTargetAt(first.top - 1, WEEK)).toBeNull();
    expect(dropTargetAt(0, WEEK)).toBeNull();
    expect(dropTargetAt(last.bottom, WEEK)).toBeNull();
    expect(dropTargetAt(99_999, WEEK)).toBeNull();
  });

  it("finds the tall open row across its whole height, not just its first 72 pixels", () => {
    // a uniform-height assumption would land a drop near the bottom of an open row on the gap
    expect(dropTargetAt(WED.top, WEEK)?.date).toBe(WED.date);
    expect(dropTargetAt(WED.top + 150, WEEK)?.date).toBe(WED.date);
    expect(dropTargetAt(WED.bottom - 1, WEEK)?.date).toBe(WED.date);
  });

  it("is unaffected by scroll, because the coordinates are the document's", () => {
    /*
     * The scroll half of the stale-rect decision, asserted rather than asserted-about. A pointer
     * at clientY 300 with scrollY 1200 is at document 1500; rows measured in document space do
     * not move when the page does, so the same drop lands on the same day.
     */
    const scrolled = (scrollY: number) => dropTargetAt(300 + scrollY, WEEK)?.date;
    expect(scrolled(WED.top - 300)).toBe(WED.date);
    expect(scrolled(WED.top - 300 + 5000)).toBeUndefined();
  });

  it("returns nothing for an empty week rather than guessing", () => {
    expect(dropTargetAt(500, [])).toBeNull();
  });
});

describe("confirming the drop against a freshly measured row", () => {
  it("accepts a drop that is still inside the row", () => {
    expect(confirmDrop(WED.top + 10, WED)).toBe(true);
  });

  it("refuses a drop whose row has moved, which is the wrong-day write", () => {
    /*
     * The case no test of `dropTargetAt` can catch. The drag began believing Wednesday was at
     * 580–780; a re-render pushed it down 90px. The pointer never moved, the old answer is still
     * "Wednesday", and the pointer is now over Thursday. Confirming against the fresh box turns
     * that into a no-op instead of a meal on the wrong day.
     */
    const y = WED.top + 10;
    const moved: RowBox = { ...WED, top: WED.top + 90, bottom: WED.bottom + 90 };
    expect(dropTargetAt(y, WEEK)?.date).toBe(WED.date);
    expect(confirmDrop(y, moved)).toBe(false);
  });

  it("refuses when the row shrank out from under the pointer", () => {
    // a row collapsing — the open panel closing mid-drag — is the same hazard with no movement
    const y = WED.top + 150;
    expect(confirmDrop(y, { ...WED, bottom: WED.top + 72 })).toBe(false);
  });

  it("forgives a sub-pixel re-measurement but never reaches the next row", () => {
    const fractional: RowBox = { date: "x", top: 100.4, bottom: 172.4 };
    expect(confirmDrop(100.1, fractional, 0.5)).toBe(true);
    // the guarantee that matters: a tolerance must not let a confirm succeed in the gap
    const tolerance = GAP / 2 - 1;
    expect(confirmDrop(WED.bottom + GAP / 2, WED, tolerance)).toBe(false);
  });

  it("uses the same boundary rule as the lookup, so one cannot accept what the other rejected", () => {
    // regression-shaped: an inclusive bottom here and an exclusive bottom there would make a drop
    // on a shared edge land on a row the lookup never chose
    for (const y of [WED.top, WED.bottom - 1, WED.bottom, WED.top - 1]) {
      expect(confirmDrop(y, WED)).toBe(dropTargetAt(y, [WED]) !== null);
    }
  });
});

describe("telling a long press from a scroll", () => {
  const { holdMs, slopPx, directionPx } = GESTURE;
  /** named so these read as sentences rather than as argument lists */
  const gestureAt = (move: { dx: number; dy: number; heldMs: number }) => gestureIntent(move);

  it("is undecided while a still finger is held, never a drag", () => {
    expect(gestureAt({ dx: 0, dy: 0, heldMs: 0 })).toBe("undecided");
    expect(gestureAt({ dx: 2, dy: 3, heldMs: holdMs - 1 })).toBe("undecided");
  });

  it("calls real movement before the hold a scroll, so the list never steals a scroll", () => {
    expect(gestureAt({ dx: 0, dy: slopPx + 1, heldMs: 10 })).toBe("scroll");
    expect(gestureAt({ dx: slopPx + 1, dy: 0, heldMs: holdMs - 1 })).toBe("scroll");
  });

  it("tolerates a thumb that is not perfectly still", () => {
    expect(gestureAt({ dx: 0, dy: slopPx, heldMs: holdMs - 1 })).toBe("undecided");
  });

  it("waits for a direction once held, rather than guessing from a jitter", () => {
    expect(gestureAt({ dx: 1, dy: 1, heldMs: holdMs })).toBe("undecided");
    expect(gestureAt({ dx: 0, dy: directionPx, heldMs: holdMs + 100 })).toBe("undecided");
  });

  it("reads mostly-vertical as a move between days", () => {
    expect(gestureAt({ dx: 4, dy: directionPx + 10, heldMs: holdMs })).toBe("drag");
    expect(gestureAt({ dx: -4, dy: -(directionPx + 10), heldMs: holdMs })).toBe("drag");
  });

  it("reads mostly-horizontal and leftward as next week, and rightward as nothing", () => {
    expect(gestureAt({ dx: -(directionPx + 10), dy: 4, heldMs: holdMs })).toBe("next-week");
    // there is no "last week" in the proposal, and a mirror image would be a control nobody
    // asked for that writes to the plan
    expect(gestureAt({ dx: directionPx + 10, dy: 4, heldMs: holdMs })).toBe("undecided");
  });

  it("splits at exactly 45 degrees without trigonometry", () => {
    const d = directionPx + 10;
    expect(gestureAt({ dx: -d, dy: d, heldMs: holdMs })).toBe("drag");
    expect(gestureAt({ dx: -(d + 1), dy: d, heldMs: holdMs })).toBe("next-week");
  });
});

describe("pausing over a day to settle", () => {
  it("does not settle before the dwell has elapsed", () => {
    let state = dwell(noDwell, "2026-10-21", 1000);
    expect(state.settled).toBeNull();
    state = dwell(state, "2026-10-21", 1000 + DWELL_MS - 1);
    expect(state.settled).toBeNull();
  });

  it("settles once the pointer has been still over one day long enough", () => {
    let state = dwell(noDwell, "2026-10-21", 1000);
    state = dwell(state, "2026-10-21", 1000 + DWELL_MS);
    expect(state.settled).toBe("2026-10-21");
  });

  it("restarts the clock when the pointer moves to a different day", () => {
    // the bug this shape prevents: a dwell accumulating across rows, so sweeping over four days
    // settles on the fourth after 400ms total rather than 400ms on it
    let state = dwell(noDwell, "2026-10-21", 1000);
    state = dwell(state, "2026-10-21", 1300);
    state = dwell(state, "2026-10-22", 1350);
    expect(state.settled).toBeNull();
    state = dwell(state, "2026-10-22", 1350 + DWELL_MS - 1);
    expect(state.settled).toBeNull();
    state = dwell(state, "2026-10-22", 1350 + DWELL_MS);
    expect(state.settled).toBe("2026-10-22");
  });

  it("clears a settle when the pointer leaves every row", () => {
    // a settle that survived the pointer wandering off is the dwell version of a stale rect:
    // a true answer about a moment that has gone
    let state = dwell(noDwell, "2026-10-21", 1000);
    state = dwell(state, "2026-10-21", 1000 + DWELL_MS);
    expect(state.settled).toBe("2026-10-21");
    state = dwell(state, null, 1500);
    expect(state.settled).toBeNull();
    expect(state.over).toBeNull();
  });

  it("keeps a settle stable rather than re-firing it every frame", () => {
    let state = dwell(noDwell, "2026-10-21", 1000);
    state = dwell(state, "2026-10-21", 1000 + DWELL_MS);
    const settled = state;
    state = dwell(state, "2026-10-21", 1000 + DWELL_MS + 200);
    expect(state).toBe(settled);
  });
});

describe("scrolling the list while dragging near an edge", () => {
  it("does not scroll in the middle of the screen", () => {
    expect(autoScrollVelocity(400, 800)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(autoScrollVelocity(10, 800)).toBeLessThan(0);
    expect(autoScrollVelocity(795, 800)).toBeGreaterThan(0);
  });

  it("ramps rather than jumping, so a drag can still be aimed", () => {
    const near = Math.abs(autoScrollVelocity(70, 800));
    const far = Math.abs(autoScrollVelocity(5, 800));
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(14);
  });

  it("is zero exactly at the edge of the hot zone, so there is no step", () => {
    expect(autoScrollVelocity(80, 800)).toBe(0);
    expect(autoScrollVelocity(720, 800)).toBe(0);
  });

  it("does not run away on a viewport shorter than two hot zones", () => {
    // a small window, or a keyboard taking half the screen: the zones overlap and the top must
    // still win rather than the two cancelling into a jitter
    const v = autoScrollVelocity(60, 120);
    expect(v).toBeLessThan(0);
  });
});
