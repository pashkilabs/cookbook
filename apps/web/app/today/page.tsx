import { redirect } from "next/navigation";
import Link from "next/link";
import { userClient } from "@/lib/supabase-server";
import { rows } from "@/lib/rows";
import { platformStore } from "@/lib/platform";
import { startOfWeek, todayIso, weekDays } from "@/lib/week";
import { buildShoppingWeek } from "@/lib/shopping";
import { leaderboard, type Rating } from "@/lib/leaderboard";
import { readAvoidedAllergens } from "@/lib/allergen-filter";
import { servingsForScale } from "@/lib/planner";
import { Eyebrow, TabBar } from "@/components/harvest";
import { TodayPlan, type PlannedMeal, type Suggestion } from "./today-plan";

/**
 * Today — what is planned, then what the household actually likes.
 *
 * ---------------------------------------------------------------------------
 * The Tonight banner on /recipes goes, and this replaces it
 * ---------------------------------------------------------------------------
 *
 * That banner exists because "what are we eating tonight" had no home: the landing screen was the
 * cookbook in reverse-chronological order, so at 5pm it opened on whatever was saved off
 * Instagram in August. It answered the question in a strip above a library.
 *
 * This screen answers it properly — per slot, with the photograph, the count still to buy, and
 * the way into cooking — so the banner would be **a second screen answering one question**, which
 * is the second-shopping-list shape §78 names. It is removed rather than left in place, and the
 * tab bar's Today now points here instead of at `/recipes`, which also fixes two tabs having had
 * one destination.
 *
 * `/recipes` keeps its own heading and becomes what its name says: the library.
 */
export default async function TodayPage() {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");

  const store = platformStore();
  const family = await store.findFamilyForAccount(auth.user.id);
  if (!family) redirect("/recipes");

  /*
   * `family_members` is a platform table, so the names come through the seam — `check-platform-
   * tables` refuses a direct query and is right to. The leaderboard needs names to say "Hazel
   * rated it 3" rather than "somebody did", which is the whole point of naming a disagreement.
   */
  const members = await store.listMembers(family.id);
  const today = todayIso(family.timezone);
  const weekStart = startOfWeek(today);

  const [planned, recipeRows, ratingRows] = await Promise.all([
    supabase
      .from("plan_entries")
      .select("id, slot, scale, cooked_at, recipe_id, recipes!inner(id, title, time_minutes, servings)")
      .eq("family_id", family.id)
      .eq("date", today)
      .is("deleted_at", null),
    supabase
      .from("recipes")
      .select("id, title, times_made")
      .eq("family_id", family.id)
      .is("deleted_at", null),
    supabase
      .from("ratings")
      .select("recipe_id, family_member_id, score")
      .eq("family_id", family.id)
      .is("deleted_at", null),
  ]);

  /*
   * §71's filter, here as everywhere recipes are offered. A recipe naming an avoided allergen is
   * **removed** from the leaderboard rather than annotated, and the count of what was removed is
   * stated — an exclusion nobody is told about is a library that has quietly shrunk.
   */
  const allergens = await readAvoidedAllergens(supabase, family.id, family.avoidedAllergens ?? []);

  const catalogue = rows(recipeRows, "recipes").map((row) => ({
    id: row.id as string,
    title: row.title as string,
    timesMade: Number(row.times_made ?? 0),
  }));
  const offerable = catalogue.filter((recipe) => !allergens.excluded.has(recipe.id));

  const ratings: Rating[] = rows(ratingRows, "ratings").map((row) => ({
    recipeId: row.recipe_id as string,
    memberId: row.family_member_id as string,
    score: Number(row.score),
  }));

  const board = leaderboard(offerable, ratings, members);
  const hiddenByAllergen = catalogue.length - offerable.length;

  const meals: PlannedMeal[] = rows(planned, "today's meals").map((row) => {
    const recipe = row.recipes as unknown as {
      id: string;
      title: string;
      time_minutes: number | null;
      servings: number | null;
    };
    const scale = Number(row.scale) || 1;
    return {
      entryId: row.id as string,
      recipeId: recipe.id,
      // a slot outside the four is impossible (a CHECK enforces it) and would still render
      // somewhere rather than vanish, which is why this is not narrowed to the union
      slot: row.slot as PlannedMeal["slot"],
      title: recipe.title,
      timeMinutes: recipe.time_minutes,
      servings: servingsForScale(scale, recipe.servings),
      cooked: row.cooked_at !== null,
    };
  });

  /*
   * ---------------------------------------------------------------------------
   * "Still to buy", from the shopping list's own derivation
   * ---------------------------------------------------------------------------
   *
   * The handoff is explicit that this must not be a second count, and it is right for a reason
   * this project has paid for twice: two implementations of one question drift, and here they
   * would drift *visibly* — a card saying "3 things" above a list showing five. So this calls
   * `buildShoppingWeek`, the same function the shopping screen renders, and counts the lines it
   * returns that are not already ticked.
   *
   * Only run when something is planned. With an empty day there is nothing to buy for and the
   * week build is several queries for an answer of zero.
   */
  let stillToBuy: number | null = null;
  if (meals.length > 0) {
    const { week } = await buildShoppingWeek(
      supabase,
      family.id,
      weekStart,
      weekDays(weekStart),
      family.measurementSystem,
    );
    /*
     * Null on a refusal, and then this says nothing rather than reporting zero — "everything is
     * bought" and "the list could not be built" are opposite facts and must not share a rendering.
     */
    if (week) {
      stillToBuy = week.byAisle
        .flatMap((group) => group.lines)
        // already in the trolley, or already in the pantry: neither is still to buy
        .filter((line) => !week.ticked.has(line.key) && !line.inPantry).length;
    }
  }

  const suggestions: Suggestion[] = board.map((row) => ({
    id: row.id,
    title: row.title,
    liked: row.liked,
    rated: row.rated,
    untried: row.untried,
    lukewarm: row.lukewarm,
    timesMade: row.timesMade,
  }));

  return (
    <div className="h-docked-page">
      <main>
        <header className="h-today-head">
          <p className="h-today-date">{longDate(today)}</p>
          <h1 className="h-title">Today</h1>
        </header>

        <TodayPlan
          today={today}
          weekStart={weekStart}
          meals={meals}
          suggestions={suggestions}
          memberCount={members.length}
          stillToBuy={stillToBuy}
        />

        {/*
          * Said, not omitted — the distinction this project keeps having to draw. "Nobody has
          * rated anything yet" and an absent section look identical and mean opposite things, and
          * with 10 rated recipes of 66 the empty case is a real state rather than a theoretical
          * one.
          */}
        {suggestions.length === 0 && (
          <section className="h-today-quiet">
            <Eyebrow>What everyone likes</Eyebrow>
            <p>
              Nobody has rated anything yet, so there is nothing to count. Mark a meal cooked on{" "}
              <Link href="/planner">the week</Link> and the scores go with it.
            </p>
          </section>
        )}

        {hiddenByAllergen > 0 && (
          <p className="h-today-hidden">
            {hiddenByAllergen} {hiddenByAllergen === 1 ? "recipe is" : "recipes are"} not shown
            because {hiddenByAllergen === 1 ? "it names" : "they name"} something this household
            avoids. <Link href="/household">Change what is avoided</Link>.
          </p>
        )}
      </main>
      <TabBar current="today" />
    </div>
  );
}

/** "Saturday, Oct 17" — built from the ISO string, never from a Date in the server's zone */
function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const at = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1, 12));
  return at.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
