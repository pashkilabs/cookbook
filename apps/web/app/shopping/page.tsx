import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { ToCart } from "./to-cart";
import { krogerConfig } from "@/lib/kroger";
import { buildShoppingWeek } from "@/lib/shopping";
import { addWeeks, isIsoDate, startOfWeek, todayIso, weekDays, weekLabel } from "@/lib/week";
import { ShoppingList } from "./shopping-list";
import { AddExtra } from "./add-extra";
import { PhotographList } from "./photograph";
import { IconLink, TabBar } from "@/components/harvest";

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

  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) redirect("/recipes");

  /*
   * The household comes first now, because the week depends on it: "this week" is a question
   * about where the household cooks, and it was answered in UTC — so a Texas Sunday evening
   * planned next week (§ the timezone decision).
   */
  const weekStart = startOfWeek(isIsoDate(requested) ? requested : todayIso(family.timezone));

  const { week, error } = await buildShoppingWeek(
    supabase,
    family.id,
    weekStart,
    weekDays(weekStart),
    family.measurementSystem,
  );

  // read server-side: `lib/kroger` holds a client secret and `check-server-only` would refuse

  // it in a "use client" file

  const krogerEnvironment = krogerConfig()?.environment ?? null;


  return (
    <div className="h-docked-page">
    <main>
      {/*
        * The week arrows live in the header; the counts and the share button are inside
        * `ShoppingList`, because both are derived from the lines it already holds and passing a
        * total down only to display it would be two places that can disagree about one number.
        */}
      <header className="h-week-head">
        <div className="h-week-nav">
          <IconLink label={`The week before ${weekLabel(weekStart)}`} href={`/shopping?week=${addWeeks(weekStart, -1)}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconLink>
          <div className="h-week-label">
            <h1 className="h-title">{weekLabel(weekStart)}</h1>
          </div>
          <IconLink label={`The week after ${weekLabel(weekStart)}`} href={`/shopping?week=${addWeeks(weekStart, 1)}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconLink>
        </div>
      </header>

      {error && <p className="error">Could not build the list: {error}</p>}

      {/*
        * Empty when there is **nothing to buy**, not when nothing is planned.
        *
        * Measured, not reasoned: a household with no plan that typed "4 kumquat kazoos" got "No
        * list yet", no aisle headings, and the item visible only inside the add box — while
        * `buildShoppingWeek` had consolidated it into `lines` all along. `extraEntries`'s own
        * comment says this case must work and it does, one layer down; the screen gated it away.
        * Each half correct, the join broken (§85).
        */}
      {week && week.plannedCount === 0 && week.lines.length === 0 && week.groupedLines.length === 0 && (
        <div className="empty">
          <h2>No list yet</h2>
          <p>
            Give some recipes a day on the planner and the shopping list writes itself — the
            same ingredient across three meals becomes one thing to buy, in the right size.
          </p>
          <div className="tabs">
            <Link className="button" href={`/planner?week=${weekStart}`}>
              Plan this week
            </Link>
          </div>
        </div>
      )}

      {week && (week.lines.length > 0 || week.groupedLines.length > 0) && (
        <ShoppingList
          weekStart={weekStart}
          plannedCount={week.plannedCount}
          byAisle={week.byAisle}
          groupedLines={week.groupedLines}
          leftovers={week.leftovers}
          suggestions={week.suggestions}
          pantry={week.pantry}
          ticked={[...week.ticked]}
        />
      )}

      {/*
        * Outside the `plannedCount > 0` branch above, deliberately.
        *
        * A household that has planned nothing can still need milk, and the whole feature would be
        * unreachable on exactly the week somebody most wants to type a list by hand. The read path
        * agrees: `buildShoppingWeek` consolidates extras even when the plan is empty.
        */}
      {week && <AddExtra weekStart={weekStart} extras={week.extras} groups={week.groups} />}
      {/*
        * The photograph path's own way in, deliberately distinct from the share control beside it
        * and deliberately labelled — the share button was read as an upload precisely because it
        * was a bare glyph, and this is the one that actually uploads.
        */}
      {week && <PhotographList weekStart={weekStart} />}
      {/*
        * The way in. Nine capabilities have shipped here with no path through them, and the
        * display of a thing is not the control for it (§69, §73).
        */}
      <ToCart weekStart={weekStart} environment={krogerEnvironment} />
    </main>
    <TabBar current="shopping" />
    </div>
  );
}
