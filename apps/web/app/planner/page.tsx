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
import { AlongsideThisWeek } from "./alongside";
import { Chip, Eyebrow, IconLink, TabBar } from "@/components/harvest";
import { weekSummary } from "@/lib/week-summary";
import { readAvoidedAllergens } from "@/lib/allergen-filter";
import { alongsideThisWeek } from "@/lib/alongside";
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

  /*
   * The waiting list is an OFFER — recipes shortlisted and not yet given a day — so it filters.
   * Anything already **placed** on a day is left alone and flagged instead: hiding a meal a
   * household has planned would make the week lie about itself, and the useful thing is to say
   * what is in it (§71).
   */
  const avoidedHere = await readAvoidedAllergens(supabase, family.id, family.avoidedAllergens);

  const waiting = (shortlist.data ?? []).filter((row) => !avoidedHere.excluded.has(row.recipe_id as string)).map((row) => ({
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
  /*
   * Each planned recipe's component names, for "made extra of —". Plain data, not a function:
   * a function cannot cross into a client component, which is how the planner once 500'd.
   */
  const partsByRecipe: Record<string, string[]> = {};
  for (const row of rows(
    await supabase
      .from("recipes")
      .select("id, components")
      .eq("family_id", family.id)
      .in("id", placed.length > 0 ? placed.map((entry) => entry.recipe.id) : ["00000000-0000-0000-0000-000000000000"])
      .not("components", "is", null),
    "components for keeping",
  )) {
    const parts = Array.isArray(row.components)
      ? (row.components as Array<{ name?: unknown }>)
          .map((part) => (typeof part?.name === "string" ? part.name.trim() : ""))
          .filter(Boolean)
      : [];
    // one part is the whole dish, correctly, and there is nothing to keep separately from it
    if (parts.length > 1) partsByRecipe[row.id as string] = parts;
  }

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

  /*
   * After the week, as a footnote. Computed here because it is a read over the household's own
   * library — no inference, no model, one query for every recipe's lines, which is the same shape
   * the shopping list already affords.
   */
  const alongside = await alongsideThisWeek(
    supabase,
    family.id,
    placed.map((entry) => entry.recipe.id),
    family.measurementSystem,
    family.avoidedAllergens,
  );

  /*
   * The thumbnails §4.4 asks for, by the same two-round-trip pattern the recipe list uses: one
   * read for the rows, one `createSignedUrls` for every path together. Signed as the person
   * viewing, so the storage policy authorises it rather than a service role.
   *
   * `source` photographs are excluded here as they are there — a grid of index cards where dish
   * photographs should be is useless to somebody scanning a week (§56).
   */
  const photoFor = new Map<string, string>();
  const plannedIds = [...new Set(placed.map((entry) => entry.recipe.id))];
  if (plannedIds.length > 0) {
    const photos = rows(
      await supabase
        .from("photos")
        .select("recipe_id, storage_path")
        .eq("family_id", family.id)
        .neq("source", "source")
        .in("recipe_id", plannedIds)
        .is("deleted_at", null),
      "photos",
    );
    const paths = [...new Set((photos ?? []).map((row) => row.storage_path as string))];
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from("recipe-photos").createSignedUrls(paths, 600);
      const urlFor = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
      for (const row of photos ?? []) {
        const url = urlFor.get(row.storage_path as string);
        if (url && !photoFor.has(row.recipe_id as string)) photoFor.set(row.recipe_id as string, url);
      }
    }
  }

  /*
   * ---------------------------------------------------------------------------
   * The two summary chips (§4.4), and why one of them says "at least"
   * ---------------------------------------------------------------------------
   *
   * "5 of 7 dinners" counts **days with a meal on them**, not plan entries — that is the number a
   * person arrives at by looking at the week, and the count-of-people rule is that nothing on
   * screen may be a figure nobody can check. Two meals on Tuesday is still one Tuesday.
   *
   * The time total is a sum of `time_minutes`, and that column is nullable: a week with three
   * timed recipes and two untimed ones would otherwise report a confident total that is simply
   * too small, with nothing on the screen to suggest it. Same shape as the calorie estimate,
   * solved the same way (§43) — a partial total says **at least**, and a complete one does not.
   * Understating silently is the failure mode; saying so is not.
   */
  // the household's own week, so "back to this week" knows where it is going — and a household
  // west of Greenwich does not get sent to last week at 11pm
  const thisWeek = startOfWeek(todayIso(family.timezone));
  const { daysWithAMeal, cookTime } = weekSummary(placed, days);

  return (
    <div className="h-docked-page">
    <main>
      <header className="h-week-head">
        <div className="h-week-nav">
          <IconLink label={`The week before ${weekLabel(weekStart)}`} href={`/planner?week=${addWeeks(weekStart, -1)}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconLink>
          <div className="h-week-label">
            <Eyebrow>Week plan</Eyebrow>
            <h1 className="h-title">{weekLabel(weekStart)}</h1>
          </div>
          <IconLink label={`The week after ${weekLabel(weekStart)}`} href={`/planner?week=${addWeeks(weekStart, 1)}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconLink>
        </div>
        <div className="h-chips">
          <Chip>
            {daysWithAMeal} of {days.length} dinners
          </Chip>
          {cookTime && <Chip tone="clay">{cookTime}</Chip>}
          {/*
            * "This week" earns its place only when the week being read is not this one — a chip
            * that navigates to where you already are is a control with nothing behind it.
            */}
          {weekStart !== thisWeek && (
            <Link className="h-chip" href="/planner">
              Back to this week
            </Link>
          )}
        </div>
      </header>

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
        partsByRecipe={partsByRecipe}
        waiting={waiting}
        warnings={warnings}
        photoFor={Object.fromEntries(photoFor)}
      />

      {/*
        * §67's footnote, and it stays a footnote.
        *
        * §4.4 asks instead for a suggestion *beside an empty day* — "Suggest: Texas Twinkies
        * (uses Tue jalapeños)". That is this same data in a more forceful position, and
        * `alongside.tsx` argues against the move in its own header: below the week, the cook has
        * already committed and it reads as "and while you're at it"; beside the day it reads as
        * "are you sure". A warning is more forceful than a display and this is a display.
        *
        * It is **allowed to say nothing**, and on most weeks it will — base overlap fires on
        * about one plan entry in six. A footnote reporting silence is correct; an absent one is
        * indistinguishable from one that failed to load, which is why it always renders.
        */}
      <AlongsideThisWeek alongside={alongside} weekStart={weekStart} />
    </main>
    <TabBar current="week" />
    </div>
  );
}
