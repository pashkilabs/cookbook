import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import {
  addWeeks,
  dayAndMonth,
  isIsoDate,
  startOfWeek,
  todayIso,
  weekDays,
  weekLabel,
  weekdayName,
} from "@/lib/week";
import { PlannerWeek } from "./planner-week";

/**
 * A week, seven days, and whatever is waiting for one.
 *
 * `?week=` is normalised to its Monday, so a link to any day in a week opens that week — and an
 * unparseable or impossible value falls back to this week rather than erroring. `isIsoDate`
 * round-trips the date for that reason: `2026-02-30` matches the shape and would otherwise
 * silently become the week of 2 March.
 *
 * Every query filters by `family_id`. On `plan_entries` the composite key already ties an entry
 * to its household, but the embedded recipe would come back for a published one otherwise, and a
 * planner is not a place to discover strangers' cooking.
 */
export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: requested } = await searchParams;
  const weekStart = startOfWeek(isIsoDate(requested) ? requested : todayIso());

  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) redirect("/recipes");

  const days = weekDays(weekStart);

  const [entries, shortlist] = await Promise.all([
    supabase
      .from("plan_entries")
      .select("id, date, scale, recipe_id, recipes!inner(id, title, servings, time_minutes)")
      .eq("family_id", family.id)
      .gte("date", days[0]!)
      .lte("date", days[6]!)
      .is("deleted_at", null)
      .order("date"),
    supabase
      .from("shortlist_entries")
      .select("id, recipe_id, recipes!inner(id, title, servings, time_minutes)")
      .eq("family_id", family.id)
      .eq("week_start", weekStart)
      .is("deleted_at", null)
      .order("created_at"),
  ]);

  const placed = (entries.data ?? []).map((entry) => ({
    id: entry.id as string,
    date: entry.date as string,
    scale: Number(entry.scale),
    recipe: entry.recipes as unknown as { id: string; title: string; servings: number | null; time_minutes: number | null },
  }));

  const waiting = (shortlist.data ?? []).map((row) => ({
    id: row.id as string,
    recipe: row.recipes as unknown as { id: string; title: string; servings: number | null; time_minutes: number | null },
  }));

  return (
    <main>
      <div className="bar">
        <div>
          <h1>{weekLabel(weekStart)}</h1>
          <p className="subtitle" style={{ margin: 0 }}>{family.name}</p>
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          <Link className="chip" href={`/planner?week=${addWeeks(weekStart, -1)}`}>
            ← Previous
          </Link>
          <Link className="chip" href="/planner">
            This week
          </Link>
          <Link className="chip" href={`/planner?week=${addWeeks(weekStart, 1)}`}>
            Next →
          </Link>
          <Link className="button" href="/recipes">
            Recipes
          </Link>
        </div>
      </div>

      {(entries.error || shortlist.error) && (
        <p className="error">
          Could not read the plan: {entries.error?.message ?? shortlist.error?.message}
        </p>
      )}

      <PlannerWeek
        weekStart={weekStart}
        today={todayIso()}
        days={days.map((date) => ({ date, weekday: weekdayName(date), label: dayAndMonth(date) }))}
        placed={placed}
        waiting={waiting}
      />

      <p className="subtitle" style={{ marginTop: "2rem" }}>
        The shopping list comes next — that is where a week of recipes becomes one trip.
      </p>
    </main>
  );
}
