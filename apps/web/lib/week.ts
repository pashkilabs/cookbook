/**
 * Week arithmetic on `YYYY-MM-DD` strings.
 *
 * **Everything is UTC, deliberately.** `meal_plans.week_start` and `plan_entries.date` are
 * Postgres `date` columns — a calendar day with no time and no zone. Doing this with local
 * `Date` objects would mean a household in Auckland planning Monday and the server storing
 * Sunday, and the bug only appears for some people at some times of year. Anchoring at UTC
 * midnight and never formatting through a locale removes the whole class, including daylight
 * saving, because no clock is ever consulted.
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

/** Today, as the calendar day it is in UTC. */
export function todayIso(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10);
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
