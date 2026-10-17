import type { ShoppingLine } from "@pashki/core";

/**
 * The same list, grouped by the meal that needs each thing (§4.5's segmented control).
 *
 * ---------------------------------------------------------------------------
 * What this must NOT do, which is the whole reason it is a tested function
 * ---------------------------------------------------------------------------
 *
 * A consolidated line says *buy one pint*. That decision belongs to the **week**, not to any one
 * meal — the pint exists precisely because Tuesday's half cup and Friday's cup were added
 * together. So a by-meal view must show each meal's **own portion** and never the package
 * decision, because repeating "buy 1 pint" under Tuesday and again under Friday would read as two
 * pints and destroy the one thing this product is for.
 *
 * Put the other way: by aisle answers *what do I buy*, by meal answers *what is it for*. Only the
 * first has packages in it.
 *
 * The tick stays keyed on the consolidated line, so crossing cream off under Tuesday crosses it
 * off under Friday too. That is correct and worth stating: you bought the cream once.
 */
export interface MealGroup {
  /** the date, which is what `groupKey` carries — null for a use with no date */
  date: string | null;
  /** the recipe title, as the planner wrote it */
  meal: string;
  items: Array<{
    /** the consolidated line's key: the tick, the pantry toggle and the row identity all use it */
    key: string;
    label: string;
    /** what THIS meal takes — never the package, never the week's total */
    portion: string;
    inPantry: boolean;
  }>;
}

export function byMeal(byAisle: ReadonlyArray<{ lines: readonly ShoppingLine[] }>): MealGroup[] {
  const groups = new Map<string, MealGroup>();

  for (const group of byAisle) {
    for (const line of group.lines) {
      for (const use of line.uses) {
        /*
         * Keyed on date *and* title. Two different recipes on one day are two meals, and the same
         * recipe on two days is two meals — a key of either alone merges one of those pairs and
         * then reports a portion that is the sum of both, which is the double-count this file
         * exists to prevent wearing a different hat.
         */
        const date = typeof use.groupKey === "string" ? use.groupKey : null;
        const id = `${date ?? ""}|${use.label}`;
        let meal = groups.get(id);
        if (!meal) {
          meal = { date, meal: use.label, items: [] };
          groups.set(id, meal);
        }
        meal.items.push({
          key: line.key,
          label: line.label,
          // "some" when the recipe gave no amount, which is what the aisle view says too — a
          // blank here would read as nothing needed rather than as an amount nobody wrote down
          portion: use.display || "some",
          inPantry: line.inPantry,
        });
      }
    }
  }

  /*
   * In the week's own order, undated meals last. The aisle view is sorted by `AISLE_ORDER` in
   * core; this is the equivalent for a shop that is reading by evening instead.
   */
  return [...groups.values()].sort((a, b) => {
    if (a.date === b.date) return a.meal.localeCompare(b.meal);
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date.localeCompare(b.date);
  });
}
