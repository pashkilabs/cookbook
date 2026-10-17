/**
 * The two figures §4.4 puts at the top of the week, and the honesty in the second one.
 *
 * Extracted from the page because both are claims a household will read as fact, and the
 * count-of-people rule is that nothing on screen may be a number nobody can check. A figure that
 * cannot be wrong on a screen is a figure that has a test.
 */
export interface WeekSummary {
  /** days with at least one meal — the number somebody arrives at by looking */
  daysWithAMeal: number;
  /** null when nothing is planned: there is no total to state, and "0m" is not the same claim */
  cookTime: string | null;
  /** true when a planned recipe has no time, so the total is a floor rather than a sum */
  partial: boolean;
}

export function weekSummary(
  placed: ReadonlyArray<{ date: string; recipe: { time_minutes: number | null } }>,
  days: readonly string[],
): WeekSummary {
  /*
   * Days, not entries. Two meals on Tuesday is still one Tuesday, and §41 allows a second entry
   * on a day rather than refusing it — so counting entries would report "8 of 7 dinners", which
   * is both wrong and unverifiable.
   */
  const daysWithAMeal = days.filter((date) => placed.some((entry) => entry.date === date)).length;

  const timed = placed.filter((entry) => entry.recipe.time_minutes !== null);
  const minutes = timed.reduce((sum, entry) => sum + (entry.recipe.time_minutes ?? 0), 0);
  /*
   * `time_minutes` is nullable, so a week of three timed recipes and two untimed ones would
   * otherwise report a confident total that is simply too small — with nothing on the screen to
   * suggest it. The same shape as the calorie estimate, and the same fix (§43): a partial total
   * says **at least**. Understating silently is the failure; saying so is not.
   */
  const partial = timed.length !== placed.length;
  if (placed.length === 0) return { daysWithAMeal, cookTime: null, partial: false };

  const written =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
      : `${minutes}m`;
  return { daysWithAMeal, cookTime: `${partial ? "at least " : ""}${written} total cook`, partial };
}
