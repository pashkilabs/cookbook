import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { buildShoppingWeek } from "@/lib/shopping";
import { addWeeks, isIsoDate, startOfWeek, todayIso, weekDays, weekLabel } from "@/lib/week";
import { ShoppingList } from "./shopping-list";

/**
 * One week, one trip.
 *
 * Every number on this page comes from `consolidate()` in `packages/core` — the merging, the
 * unit conversion, the package choice, the leftovers and the aisle order. Nothing is recomputed
 * here, and if something is missing it belongs in core with a test rather than in this file.
 */
export default async function ShoppingPage({
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

  const { week, error } = await buildShoppingWeek(
    supabase,
    family.id,
    weekStart,
    weekDays(weekStart),
  );

  return (
    <main>
      <div className="bar">
        <div>
          <h1>Shopping</h1>
          <p className="subtitle" style={{ margin: 0 }}>{weekLabel(weekStart)}</p>
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          <Link className="chip" href={`/shopping?week=${addWeeks(weekStart, -1)}`}>← Previous</Link>
          <Link className="chip" href={`/shopping?week=${addWeeks(weekStart, 1)}`}>Next →</Link>
          <Link className="button" href={`/planner?week=${weekStart}`}>Planner</Link>
        </div>
      </div>

      {error && <p className="error">Could not build the list: {error}</p>}

      {week && week.plannedCount === 0 && (
        <div className="empty">
          <p style={{ marginTop: 0 }}>Nothing is planned for this week.</p>
          <p style={{ marginBottom: 0 }}>
            <Link href={`/planner?week=${weekStart}`}>Give some recipes a day</Link> and the list
            builds itself.
          </p>
        </div>
      )}

      {week && week.plannedCount > 0 && (
        <ShoppingList
          weekStart={weekStart}
          plannedCount={week.plannedCount}
          byAisle={week.byAisle}
          leftovers={week.leftovers}
          suggestions={week.suggestions}
          pantry={week.pantry}
          ticked={[...week.ticked]}
        />
      )}
    </main>
  );
}
