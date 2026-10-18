/**
 * Which recipes a slot tab shows, and which tab opens.
 *
 * ---------------------------------------------------------------------------
 * Lunch and Dinner show the same recipes, on purpose
 * ---------------------------------------------------------------------------
 *
 * `recipes.course` has seven values and **no `lunch`**, and a household eats mains at both meals.
 * So the two tabs differ in the `slot` a `+` writes, not in what they offer, and inventing a
 * distinction the data cannot support is exactly what the dead `lunch` chip was (§78).
 *
 * What would separate them later is `plan_entries` history — a recipe planned at lunch five times
 * is this household's lunch. All 40 live entries are `dinner`, so there is no signal yet. That is
 * the reversal condition, not a thing to build now.
 *
 * ---------------------------------------------------------------------------
 * A null course is main-ish, and that is a decision the spec did not cover
 * ---------------------------------------------------------------------------
 *
 * `course` is nullable — *"inferred at import, corrected on the review screen, null when
 * unknown"* — and the spec's mapping listed only the seven enum values. Measured against the real
 * library that drops **24 of 66 recipes** out of every tab, including **5 of the 10 rated ones**,
 * so the dinner leaderboard would have shown half of itself with nothing saying so.
 *
 * Null is *unknown*, not *none*. Three options existed and only one is defensible: invisible
 * everywhere loses a third of the library; visible on every tab makes the tabs meaningless;
 * visible on the main-meal tabs puts an unclassified recipe where 31 of the 43 classified ones
 * already are. `drink` joins Snack for the same reason — it is the only course the spec's table
 * forgot, and one recipe having no home is still a recipe with no home.
 *
 * Same shape as §83: a specification written against what the column **permits** rather than what
 * the rows **contain**.
 */
export const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Slot = (typeof SLOTS)[number];

/** short enough for four tabs on a 390px phone, which is why it is not "Breakfast" */
export const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Bkfst",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

/** the heading, and the plural a count attaches to: "41 dinners" */
export const SLOT_NOUN: Record<Slot, { one: string; many: string }> = {
  breakfast: { one: "breakfast", many: "breakfasts" },
  lunch: { one: "lunch", many: "lunches" },
  dinner: { one: "dinner", many: "dinners" },
  snack: { one: "snack", many: "snacks" },
};

/** `null` is in the list wherever an unclassified recipe belongs — see the header */
const SHOWS: Record<Slot, ReadonlyArray<string | null>> = {
  breakfast: ["breakfast"],
  lunch: ["main", "side", "starter", null],
  dinner: ["main", "side", "starter", null],
  snack: ["snack", "dessert", "drink"],
};

export function showsOnSlot(course: string | null, slot: Slot): boolean {
  return SHOWS[slot].includes(course);
}

/** every course this mapping can place, so a test can prove nothing falls through */
export const PLACED_COURSES: ReadonlyArray<string | null> = [...new Set(Object.values(SHOWS).flat())];

/**
 * The tab that opens: the next meal worth planning, not the current one.
 *
 * After 20:00 it stays on Dinner rather than rolling to tomorrow's breakfast. Tomorrow is a
 * different day and the week owns it — a screen called Today opening on a meal that is not today's
 * would be the screen disagreeing with its own name.
 *
 * Read from `family.timezone` on the **server**. A device clock would disagree with the planner
 * for anybody whose phone differs, which is the split that column exists to close, and deriving it
 * in a client effect would flip the tab after hydration.
 */
export function slotForHour(hour: number): Slot {
  if (hour < 9) return "breakfast";
  if (hour < 13) return "lunch";
  return "dinner";
}

/**
 * The household's hour, from the same zone `todayIso` reads — and failing the same way.
 *
 * `Intl.DateTimeFormat` **throws** on an unresolvable zone rather than returning something odd, so
 * the `Number.isFinite` guard a first draft had here was dead code and the comment above it was
 * wrong. `todayIso` already answers this: catch, fall back to UTC, and document why — the database
 * refuses a zone it cannot resolve (`families_timezone_is_known`), so reaching the catch means the
 * runtime and Postgres disagree about the zone table, which is not worth taking a page down for.
 *
 * Falling back to **UTC** rather than to midday, because these two functions read the same column
 * on the same screen and two different fallbacks would put the date and the tab in different
 * zones — which is the disagreement the column exists to prevent.
 */
export function hourIn(timezone: string, now: Date = new Date()): number {
  try {
    // `hourCycle: "h23"` so midnight is 0; `hour12: false` alone can render it as 24 and the
    // boundary at `hour < 9` would then be the only branch it ever missed
    const text = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now);
    return Number(text) % 24;
  } catch {
    return now.getUTCHours();
  }
}

export const isSlot = (value: unknown): value is Slot =>
  typeof value === "string" && (SLOTS as readonly string[]).includes(value);
