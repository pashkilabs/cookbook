/**
 * Week arithmetic on `YYYY-MM-DD` strings.
 *
 * **Everything is UTC, deliberately.** `meal_plans.week_start` and `plan_entries.date` are
 * Postgres `date` columns — a calendar day with no time and no zone. Doing this with local
 * `Date` objects would mean a household in Auckland planning Monday and the server storing
 * Sunday, and the bug only appears for some people at some times of year. Anchoring at UTC
 * midnight and never formatting through a locale removes the whole class, including daylight
 * saving.
 *
 * **One clock is consulted, and only one: `todayIso`.** The header used to claim none was, and
 * that was the bug — see below. Every other function here is pure arithmetic on date strings and
 * consults nothing.
 *
 * Weeks start on **Monday**. That is a product choice: a shopping trip belongs to the week it
 * feeds, and a Sunday-start week splits a weekend across two shops.
 */
export type IsoDate = string;

const DAY_MS = 86_400_000;

/**
 * Validated by round-tripping, not by the shape alone.
 *
 * `Date.UTC(2026, 1, 30)` does not fail — it rolls into March. So a well-formed but impossible
 * day like `2026-02-30` would pass a regex and a NaN check and then quietly become a different
 * week, and `?week=` is user input. Formatting it back and comparing is the only test that
 * catches it.
 */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = toUtc(value);
  return !Number.isNaN(ms) && fromUtc(ms) === value;
}

function toUtc(date: IsoDate): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

export function addWeeks(date: IsoDate, weeks: number): IsoDate {
  return addDays(date, weeks * 7);
}

/** The Monday of the week containing `date`. Idempotent: a Monday returns itself. */
export function startOfWeek(date: IsoDate): IsoDate {
  const weekday = new Date(toUtc(date)).getUTCDay(); // 0 = Sunday
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  return addDays(date, -backToMonday);
}

export function weekDays(weekStart: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset));
}

/**
 * Today, as the calendar day it is **where the household cooks**.
 *
 * regression: this returned the UTC calendar day, which is wrong every evening for anybody west
 * of Greenwich. In Texas at 5pm on Tuesday it is already Wednesday in UTC, so the planner rang
 * the wrong day, and on a Sunday evening "Make this week" quietly meant next week. The file
 * header claimed no clock was ever consulted, which made the one place that does consult one
 * look like it did not.
 *
 * The zone comes from the household, not the device (§28's reasoning): two adults on two phones
 * in two places must read one week, and a device guess would make "this week" mean different
 * things to the two people planning it. It also has to work on a server, where the device is a
 * data centre.
 *
 * `en-CA` because its short date format *is* `YYYY-MM-DD`, so this needs no reassembly — and
 * reassembling parts by hand is where a zero-padding bug lives.
 */
export function todayIso(timezone: string, now: Date = new Date()): IsoDate {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    /*
     * An unresolvable zone falls back to UTC, which is what this did for everybody before the
     * column existed — so the failure is the old behaviour rather than a new one. The database
     * refuses to store a zone it cannot resolve (`families_timezone_is_known`), so reaching here
     * means the runtime and Postgres disagree about the zone table, which is worth not crashing
     * a page over.
     */
    return now.toISOString().slice(0, 10);
  }
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function weekdayName(date: IsoDate): string {
  return WEEKDAY_NAMES[new Date(toUtc(date)).getUTCDay()]!;
}

/** "12 August", for a day heading. Formatted here rather than by a locale, for the same reason. */
export function dayAndMonth(date: IsoDate): string {
  const at = new Date(toUtc(date));
  return `${at.getUTCDate()} ${MONTH_NAMES[at.getUTCMonth()]}`;
}

/** "11–17 August 2026", spanning a month or a year boundary correctly. */
export function weekLabel(weekStart: IsoDate): string {
  const end = addDays(weekStart, 6);
  const from = new Date(toUtc(weekStart));
  const to = new Date(toUtc(end));
  const sameMonth = from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear();
  if (sameMonth) {
    return `${from.getUTCDate()}–${to.getUTCDate()} ${MONTH_NAMES[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
  }
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const left = sameYear
    ? `${from.getUTCDate()} ${MONTH_NAMES[from.getUTCMonth()]}`
    : `${from.getUTCDate()} ${MONTH_NAMES[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
  return `${left} – ${to.getUTCDate()} ${MONTH_NAMES[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
}
