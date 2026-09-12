import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { platformClient, platformStore } from "@/lib/platform";
import { rows } from "@/lib/rows";
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
import type { CookMember } from "./cooked";
import { childTastes, warningsFor } from "@/lib/tastes";

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

  const days = weekDays(weekStart);

  const [entries, shortlist] = await Promise.all([
    supabase
      .from("plan_entries")
      .select("id, date, scale, cooked_at, recipe_id, recipes!inner(id, title, servings, time_minutes)")
      .eq("family_id", family.id)
      .gte("date", days[0]!)
      .lte("date", days[6]!)
      .is("deleted_at", null)
      .order("date"),
    supabase
      .from("shortlist_entries")
      .select("id, recipe_id, recipes!inner(id, title, servings, time_minutes, cuisine, principal_protein, dish_form)")
      .eq("family_id", family.id)
      .eq("week_start", weekStart)
      .is("deleted_at", null)
      .order("created_at"),
  ]);

  const placed = (entries.data ?? []).map((entry) => ({
    id: entry.id as string,
    date: entry.date as string,
    scale: Number(entry.scale),
    cookedAt: (entry.cooked_at as string | null) ?? null,
    recipe: entry.recipes as unknown as { id: string; title: string; servings: number | null; time_minutes: number | null },
  }));

  const waiting = (shortlist.data ?? []).map((row) => ({
    id: row.id as string,
    recipe: row.recipes as unknown as { id: string; title: string; servings: number | null; time_minutes: number | null },
  }));

  /*
   * Only the warnings, not the ratings.
   *
   * `childTastes` reads every child's scores; what crosses to the client is a display name, a
   * dimension value and a count — enough for the sentence and nothing more. A child's rating of
   * a recipe is the household's business, and it does not need to be in a page's props to warn
   * somebody about fish.
   */
  const tastes = await childTastes(supabase, auth.user.id, family.id);
  const warnings: Record<string, Array<{ displayName: string; value: string; count: number }>> = {};
  for (const { id, recipe } of waiting) {
    const found = warningsFor(tastes, recipe as never);
    if (found.length > 0) {
      warnings[recipe.id] = found.map((w) => ({
        displayName: w.displayName,
        value: w.reading.value,
        count: w.reading.count,
      }));
    }
  }

  /*
   * Everyone in the household, so a meal can be rated where it was cooked.
   *
   * Through the seam, because "who is in this household" is a platform question and
   * `family_members` is a platform table. Adults and children alike: children are rated and
   * never sign in, so an adult sets every score including their own.
   */
  const members = await platformClient(auth.user.id).listMembers();
  const scores = rows(
    await supabase
      .from("ratings")
      .select("recipe_id, family_member_id, score")
      .eq("family_id", family.id)
      .is("deleted_at", null)
      .in("recipe_id", placed.map((entry) => entry.recipe.id)),
    "ratings for the week",
  );
  /*
   * A plain object, not a function.
   *
   * regression: this was `membersFor: (recipeId) => CookMember[]` handed to `PlannerWeek`, which
   * is a client component — and **a function cannot cross that boundary**. It is not a type
   * error, so `tsc` passed; it is a runtime refusal, so the planner 500'd in production for
   * every household while `pnpm check` was green. `pnpm smoke` never loaded the page.
   *
   * I made the same mistake earlier the same day with `continueTo` in the blend picker, caught
   * it, and wrote a comment there saying a function cannot cross the boundary. Knowing the rule
   * did not stop me repeating it, which is what `check-client-props.mjs` is for.
   */
  const membersByRecipe: Record<string, CookMember[]> = {};
  for (const entry of placed) {
    if (membersByRecipe[entry.recipe.id]) continue;
    membersByRecipe[entry.recipe.id] = members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      score:
        (scores.find(
          (row) => row.recipe_id === entry.recipe.id && row.family_member_id === member.id,
        )?.score as number | null) ?? null,
    }));
  }

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
          <Link className="button" href={`/shopping?week=${weekStart}`}>
            Shopping
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

      {/* computed here, on the server, so no child's ratings cross to the browser — only the
          sentence a person reads */}
      <PlannerWeek
        weekStart={weekStart}
        today={todayIso(family.timezone)}
        days={days.map((date) => ({ date, weekday: weekdayName(date), label: dayAndMonth(date) }))}
        placed={placed}
        familyId={family.id}
        membersByRecipe={membersByRecipe}
        waiting={waiting}
        warnings={warnings}
      />


    </main>
  );
}
