import Link from "next/link";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase-server";
import { maybeRow, rows } from "@/lib/rows";
import { platformStore } from "@/lib/platform";
import { keepWholeFamilyLikes, searchRecipes } from "@/lib/recipe-search";
import { allergenSentence } from "@/lib/allergen-filter";
import { andList } from "@/lib/energy";
import { startOfWeek, addWeeks, todayIso } from "@/lib/week";
import { ShortlistButton } from "./shortlist-button";
import { Filters, FILTERS, type FilterKey } from "./filters";
import { COURSES, PROTEINS } from "./drill-down";
import { keepKidFriendly } from "@/lib/tastes";
/*
 * Still imported for the no-household branch below, where signing out is the only way out of a
 * dead end. It left the main header — that is an account action and belongs on /household — but
 * removing it from a screen somebody can be stranded on would be a different bug.
 */
import { SignOutButton } from "./sign-out";
import { Chip, Eyebrow, SecondaryLink, TabBar } from "@/components/harvest";
import { AT_A_TIME, chapters, isRecipeLayout, rotation, type Planned } from "@/lib/recipe-layout";
import { Choosing } from "./choosing";
import { Tile } from "./tile";

/**
 * The household's recipes, with the prototype's three filters.
 *
 * Reads go through the signed-in person's own session so row-level security decides which rows
 * come back. **It still filters by `family_id`, and that is not redundant.** Published recipes
 * are world-readable (decisions §17), so RLS legitimately returns other households' public
 * recipes — the first render of this page duly showed a stranger's roast chicken. Isolation and
 * presentation are different questions.
 *
 * The household id comes from the seam, because `family_members` is a platform table and
 * `check-platform-tables.mjs` fails the build on a direct read.
 */
/** "Oct 12" — from the ISO parts, so the server's zone cannot shift the day */
function readableDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1, 12)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; in?: string; protein?: string; pick?: string }>;
}) {
  const { q: rawQuery, filter: rawFilter, in: rawCourse, protein: rawProtein, pick } = await searchParams;
  const chosen = COURSES.find((entry) => entry.key === rawCourse) ?? null;
  const protein = PROTEINS.includes(rawProtein as (typeof PROTEINS)[number]) ? rawProtein! : null;
  const q = (rawQuery ?? "").trim();
  const filter = FILTERS.some((option) => option.key === rawFilter)
    ? (rawFilter as FilterKey)
    : null;

  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) {
    return (
      <main>
        <div className="bar">
          <div>
            <h1>Recipes</h1>
            <p className="subtitle" style={{ margin: 0 }}>{auth.user.email}</p>
          </div>
          <SignOutButton />
        </div>
        <div className="notice">
          This account has no household yet. Signing out and back in completes provisioning.
        </div>
      </main>
    );
  }

  /*
   * The household's avoided allergens, through the seam, into the one function both the list and
   * search go through (§71). The reported bug was that this setting saved and changed nothing:
   * the matcher was measured, the control rendered, and no call site joined them.
   */
  const found = await searchRecipes({
    supabase,
    familyId: family.id,
    query: q,
    filter,
    avoidedAllergens: family.avoidedAllergens,
  });
  const hits =
    filter === "family-likes"
      ? await keepWholeFamilyLikes(supabase, family.id, found.hits)
      : filter === "kid-friendly"
        ? await keepKidFriendly(supabase, auth.user.id, family.id, found.hits)
        : found.hits;
  const error = found.error;

  // which of these are already wanted this week, so the button starts in the right state
  const today = todayIso(family.timezone);
  const weekStart = startOfWeek(today);

  /*
   * What are we eating tonight — the question this screen could not answer.
   *
   * Read here rather than on the planner because this is the screen somebody opens at 5pm. Both
   * queries are family-scoped explicitly: RLS decides what may leave the database, a screen
   * decides whose kitchen it shows.
   */
  /*
   * The Tonight banner lived here and has moved to `/today` (§82).
   *
   * It existed because "what are we eating tonight" had no home, and it answered the question in
   * a strip above a library. Today answers it per slot, with the photograph, the still-to-buy
   * count and the way into cooking — so leaving this in place would be a second screen answering
   * one question, which is the shape §78 names and this project has paid for twice. Its two
   * queries went with it rather than being left to feed nothing.
   */
  // both weeks, because shortlisting only ever reached this one and the planner's waiting list
  // is week-scoped — so a recipe was stranded here while next week showed empty
  const nextWeekStart = addWeeks(weekStart, 1);
  /*
   * Narrow the hits by course, dish form and protein, and work out which protein chips this
   * household can even use — a chip that leads to an empty list reads as broken.
   *
   * Filtered here rather than in the query because `searchRecipes` already ran and its ranking is
   * what orders the list; re-querying would throw that away to save a pass over at most a few
   * hundred rows.
   */
  /*
   * ---------------------------------------------------------------------------
   * The layout, and the data each branch needs
   * ---------------------------------------------------------------------------
   *
   * `family.recipeLayout` is NOT NULL with a default, so there is no fallback branch to forget.
   * `isRecipeLayout` still guards it, because a value stored before a layout was removed from the
   * code would otherwise reach a screen with no branch for it.
   *
   * `searching` suspends the layout: a query or a filter means somebody has stopped browsing and
   * started looking, and chaptering a result set buries what they asked for.
   */
  const layout = isRecipeLayout(family.recipeLayout) ? family.recipeLayout : "rotation";
  const searching = q.length > 0 || filter !== null || chosen !== null || protein !== null;

  const narrowed = hits.filter(({ recipe }) => {
    const row = recipe as unknown as Record<string, string | null>;
    if (chosen && row[chosen.field] !== chosen.key) return false;
    if (protein && row.principal_protein !== protein) return false;
    return true;
  });
  const proteinsAvailable = chosen
    ? PROTEINS.filter((key) =>
        hits.some(
          ({ recipe }) =>
            (recipe as unknown as Record<string, string | null>)[chosen.field] === chosen.key &&
            (recipe as unknown as Record<string, string | null>).principal_protein === key,
        ),
      )
    : [];

  const shortlisted = rows(
    await supabase
    .from("shortlist_entries")
    .select("recipe_id, week_start")
    .eq("family_id", family.id)
    .in("week_start", [weekStart, nextWeekStart])
    .is("deleted_at", null),
    "shortlisted",
  );
  // one set per week: a recipe on next week's list must not light up this week's button
  const onThisWeek = new Set(
    shortlisted.filter((row) => row.week_start === weekStart).map((row) => row.recipe_id),
  );
  const onNextWeek = new Set(
    shortlisted.filter((row) => row.week_start === nextWeekStart).map((row) => row.recipe_id),
  );

  /*
   * ---------------------------------------------------------------------------
   * The rotation's order, from `plan_entries`
   * ---------------------------------------------------------------------------
   *
   * Planning frequency, not `times_made`. Measured: 36 plan-entry rows over 26 recipes, against a
   * `times_made` that tops out at **2** — so one is a signal and the other is barely populated.
   *
   * The signal is also **flat**: the top eight are 3, 3, 2, 2, 2, 2, 2, 2. Six recipes tie at two,
   * so the tie-break decides most of the order, and `rotation()` breaks it on most-recently-planned
   * then title — both total orders, so the page cannot reorder itself between visits. An unstable
   * rotation would destroy the spatial memory the layout exists for.
   */
  let regulars: Planned[] = [];
  let untriedCount = 0;
  /* read once: the rotation orders by it and `decide` picks by it */
  const plannedCounts = new Map<string, { planned: number; lastPlanned: string | null }>();
  if ((layout === "rotation" || layout === "decide") && !searching) {
    const entries = rows(
      await supabase
        .from("plan_entries")
        .select("recipe_id, date")
        .eq("family_id", family.id)
        .is("deleted_at", null),
      "plan entries for the rotation",
    );
    const counts = plannedCounts;
    for (const entry of entries) {
      const id = entry.recipe_id as string;
      const seen = counts.get(id) ?? { planned: 0, lastPlanned: null };
      const date = entry.date as string;
      counts.set(id, {
        planned: seen.planned + 1,
        lastPlanned: seen.lastPlanned && seen.lastPlanned > date ? seen.lastPlanned : date,
      });
    }
    regulars = rotation(
      narrowed.map(({ recipe }) => ({
        id: recipe.id,
        title: recipe.title,
        planned: counts.get(recipe.id)?.planned ?? 0,
        lastPlanned: counts.get(recipe.id)?.lastPlanned ?? null,
      })),
    );
    // a count, not "more": how many of this household's recipes have never been given a day
    untriedCount = narrowed.filter(({ recipe }) => !counts.has(recipe.id)).length;
  }

  /*
   * Time (§85). The three bands the handoff names, plus one for the recipes with no time at all:
   * `time_minutes` is set on **42 of 67**, so a quarter of the library would otherwise vanish
   * from this layout — the same decision §84 reached about a null course, for the same reason.
   */
  const timeBands =
    layout === "time" && !searching
      ? [
          { key: "30", label: "30 minutes or less", within: (m: number | null) => m !== null && m <= 30 },
          { key: "60", label: "An hour or less", within: (m: number | null) => m !== null && m > 30 && m <= 60 },
          { key: "long", label: "A weekend job", within: (m: number | null) => m !== null && m > 60 },
          { key: "unknown", label: "No time recorded", within: (m: number | null) => m === null },
        ]
          .map((band) => {
            const mine = narrowed.filter(({ recipe }) => band.within(recipe.time_minutes));
            return { ...band, items: mine.slice(0, AT_A_TIME), total: mine.length };
          })
          .filter((band) => band.total > 0)
      : [];

  /*
   * Just tell us what to cook (§85). One pick, and the **reason is the feature** — §67 settled
   * that a suggestion states what it rests on or it is a verdict.
   *
   * Picked from what the household has planned least recently among things it has planned at all,
   * which is a fact it can check rather than a score it cannot. `?pick=` rotates through the
   * candidates so "something else" is a tap and not a reroll nobody can predict.
   */
  const suggestion = (() => {
    if (layout !== "decide" || searching) return null;
    const candidates = narrowed
      .map(({ recipe }) => ({ recipe, planned: plannedCounts.get(recipe.id) }))
      .filter((entry) => entry.planned)
      .sort((a, b) => (a.planned!.lastPlanned ?? "").localeCompare(b.planned!.lastPlanned ?? ""));
    if (candidates.length === 0) return null;
    const at = Math.min(Math.max(0, Number(pick) || 0), candidates.length - 1);
    const chosen = candidates[at]!;
    const since = chosen.planned!.lastPlanned;
    return {
      recipe: chosen.recipe,
      why: since
        ? `You last planned it on ${readableDate(since)}, which is longer ago than anything else you cook.`
        : "You have planned it before and not lately.",
      next: (at + 1) % candidates.length,
    };
  })();

  const chaptered = layout === "browse" && !searching ? chapters(narrowed.map((hit) => ({ ...hit, course: hit.recipe.course ?? null }))) : [];

  /*
   * The photographs, so the list is something a person recognises rather than a wall of titles.
   *
   * Two round trips for the whole page, not two per card: one read for the rows, one
   * `createSignedUrls` for all the paths together. The bucket is private, so a URL has to be
   * signed — and it is signed as the person viewing, so the storage policy is what authorises it,
   * the same reasoning as reading the rows.
   */
  const photoFor = new Map<string, string>();
  if (hits.length > 0) {
    const photos = rows(
    await supabase
      .from("photos")
      .select("recipe_id, storage_path")
      .eq("family_id", family.id)
      // never a card: a grid of index cards where dish photographs should be reads as a filing
      // cabinet, and is useless to somebody scanning for what to eat (§56)
      .neq("source", "source")
      // every id any branch may render: the flat list, the rotation, and the chapters
      .in(
        "recipe_id",
        [
          ...new Set([
            ...narrowed.map(({ recipe }) => recipe.id),
            ...regulars.map((recipe) => recipe.id),
            ...chaptered.flatMap((chapter) => chapter.items.map(({ recipe }) => recipe.id)),
          ]),
        ],
      )
      .is("deleted_at", null),
    "photos",
  );

    const paths = [...new Set((photos ?? []).map((row) => row.storage_path as string))];
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("recipe-photos")
        .createSignedUrls(paths, 600);
      const urlFor = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
      for (const row of photos ?? []) {
        const url = urlFor.get(row.storage_path as string);
        // one photograph per card; a recipe with several is showing whichever came back first
        if (url && !photoFor.has(row.recipe_id as string)) photoFor.set(row.recipe_id as string, url);
      }
    }
  }

  /*
   * The date, in the household's timezone — not the device's.
   *
   * `today` already came from `todayIso(family.timezone)`, and this only formats it. A browser
   * would happily say Friday to somebody whose household reads Saturday, which is the split the
   * timezone column exists to close.
   */
  const dateLine = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: "UTC",
  });

  return (
    <div className="h-docked-page">
    <main>
      {/*
        * The question the screen answers, asked in the header (§4).
        *
        * It replaced the household name and the signed-in email, which told somebody what they
        * already knew. The five links that were here are the tab bar now — navigation belongs in
        * one place, and `Import` stays because §4 puts it here and it is the one action this
        * screen offers that is not about a recipe already in it.
        *
        * Signing out moved to /household, one tab away: it is an account action, it was never in
        * the reference, and a destructive-ish control beside four navigation links is the kind of
        * thing a thumb finds by accident.
        */}
      <div className="h-section" style={{ alignItems: "center" }}>
        <div>
          <p className="meta" style={{ margin: 0 }}>{dateLine}</p>
          <h1 className="h-title">What&rsquo;s for dinner?</h1>
        </div>
        <SecondaryLink href="/recipes/import">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Import
        </SecondaryLink>
      </div>


            <Filters
        q={q}
        filter={filter}
        course={chosen?.key ?? null}
        protein={protein}
        proteinsAvailable={proteinsAvailable}
      />

      {error && <p className="error">Could not read recipes: {error}</p>}

      {!error && hits.length === 0 && (
        <div className="empty">
          {q || filter ? (
            <>
              <h2>Nothing matches that</h2>
              <p>
                Search looks at titles and ingredients, so “chicken” finds the recipes you can
                cook with what you bought.
              </p>
              <div className="tabs">
                <Link className="button quiet" href="/recipes">
                  Clear search and filters
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2>Your cookbook is empty</h2>
              <p>
                Paste a link from anywhere and it reads the recipe for you — you check it before
                anything is saved. Or type one in from a card or a book.
              </p>
              <div className="tabs">
                <Link className="button" href="/recipes/import">
                  Import from a link
                </Link>
                <Link className="button quiet" href="/recipes/new">
                  Type one in
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      <div className="recipes">
      {/*
        * The count of what was removed, stated rather than left silent.
        *
        * A filter that quietly shortens a list is indistinguishable from a household that owns
        * fewer recipes — and this project's own rule is that a smaller number nobody is counting
        * reads as success. Saying it also makes the setting checkable: somebody can see the
        * filter working instead of trusting that it is.
        */}
      {(found.hiddenByAllergen ?? 0) > 0 && (
        <p className="meta">
          {found.hiddenByAllergen} hidden: {andList(family.avoidedAllergens.map((a) => (a === "tree-nut" ? "tree nuts" : a)))}{" "}
          written in the ingredients. <Link href="/household">Change what you avoid</Link>.
        </p>
      )}

      {/*
        * The question, once, where the problem is visible — and only where it has never been put.
        * `recipe_layout_asked_at` is null for a household that has not answered, and a dismissal
        * stamps it, so "not now" is permanent and "never asked" is the only state that prompts.
        */}
      {family.recipeLayoutAskedAt === null && narrowed.length > AT_A_TIME && (
        <Choosing total={narrowed.length} />
      )}

      {/*
        * ---------------------------------------------------------------------------
        * The layout, and the rule all of them obey
        * ---------------------------------------------------------------------------
        *
        * 67 recipes in one scroll is roughly ten times the choice-overload threshold the research
        * puts at five to seven. The constraint is **not** *group them* — "Mains 28" is still 28
        * once tapped — it is never show more than about seven at once.
        *
        * Server-rendered branches rather than a client toggle, for the reason the Today screen's
        * hour-of-day default is read on the server: a layout chosen after hydration flips under
        * the reader.
        *
        * A search or a filter **suspends the layout**. Somebody who has typed a query has stopped
        * browsing and started looking, and chaptering a result set would bury the thing they
        * asked for — the Index idea was dropped as a *mode* for exactly this reason: knowing the
        * name is a different job, and it is on every layout rather than being one.
        */}
      {layout === "rotation" && !searching && regulars.length > 0 && (
        <section className="h-layout">
          <div className="h-shelf-head">
            <Eyebrow>What you cook · {regulars.length}</Eyebrow>
            <Link href="/recipes?filter=make-again">See all</Link>
          </div>
          {/* a shelf, not a grid — see harvest.css for why the Shelves objection does not apply */}
          <div className="h-shelf">
            {regulars.map((recipe) => (
              <Tile
                key={recipe.id}
                id={recipe.id}
                title={recipe.title}
                photo={photoFor.get(recipe.id)}
                meta={`planned ${recipe.planned}×`}
              />
            ))}
          </div>
          {/*
            * The band that stops a rotation calcifying into the only thing anybody sees. Named
            * with a count rather than "more", because a number is checkable.
            */}
          {/*
            * Only when there is something to try. A band reading "0 you have never planned" is a
            * control offering nothing — visible in the first screenshot of the fixed layout, and
            * invisible in every guard, because zero is a perfectly good number.
            */}
          {untriedCount > 0 && (
          <Link className="h-layout-band" href="/recipes?filter=untried">
            <span>
              <strong>Try something new</strong>
              <span className="h-layout-count">{untriedCount} you have never planned</span>
            </span>
            <span className="h-layout-new">new</span>
          </Link>
          )}
        </section>
      )}

      {layout === "browse" && !searching && (
        <section className="h-layout">
          {chaptered.map((chapter) => (
            <div className="h-chapter" key={chapter.key}>
              <div className="h-chapter-head">
                <Eyebrow>{chapter.label}</Eyebrow>
                <span className="h-layout-count">{chapter.total}</span>
              </div>
              <div className="h-layout-grid">
                {chapter.items.map(({ recipe }) => (
                  <Tile key={recipe.id} id={recipe.id} title={recipe.title} photo={photoFor.get(recipe.id)} />
                ))}
              </div>
              {chapter.total > chapter.items.length && (
                <Link className="h-layout-more" href={`/recipes?in=${chapter.key}`}>
                  Show the other {chapter.total - chapter.items.length}
                </Link>
              )}
            </div>
          ))}
        </section>
      )}

      {/*
        * Time (§85). Three bands, and a fourth for the 25 of 67 with no time recorded — named
        * rather than hidden, because a quarter of the library cannot be silently absent and a
        * band you can see is a band you can fix.
        */}
      {layout === "time" && !searching && (
        <section className="h-layout">
          {timeBands.map((band) => (
            <div className="h-chapter" key={band.key}>
              <div className="h-chapter-head">
                <Eyebrow>{band.label}</Eyebrow>
                <span className="h-layout-count">{band.total}</span>
              </div>
              <div className="h-layout-grid">
                {band.items.map(({ recipe }) => (
                  <Tile
                    key={recipe.id}
                    id={recipe.id}
                    title={recipe.title}
                    photo={photoFor.get(recipe.id)}
                    meta={recipe.time_minutes ? `${recipe.time_minutes} min` : undefined}
                  />
                ))}
              </div>
              {band.total > band.items.length && (
                <Link className="h-layout-more" href={`/recipes?time=${band.key}`}>
                  Show the other {band.total - band.items.length}
                </Link>
              )}
            </div>
          ))}
        </section>
      )}

      {/*
        * Just tell us what to cook (§85). One suggestion, and **the reason is the feature** —
        * §67 settled that a suggestion states what it rests on or it is a verdict somebody can
        * only accept or ignore. "Something else" is one tap, because a bad pick twice running is
        * how this one dies.
        */}
      {layout === "decide" && !searching && suggestion && (
        <section className="h-layout">
          <article className="h-plate">
            {photoFor.has(suggestion.recipe.id) ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire
              <img className="h-plate-photo" src={photoFor.get(suggestion.recipe.id)} alt="" />
            ) : (
              <span className="h-plate-photo" aria-hidden="true">
                {suggestion.recipe.title.trim().charAt(0).toUpperCase() || "?"}
              </span>
            )}
            <div className="h-plate-body">
              <p className="h-layout-count">Tonight you could cook</p>
              <h2 className="h-plate-title">{suggestion.recipe.title}</h2>
              <p className="h-plate-why">{suggestion.why}</p>
              <div className="h-meal-actions">
                <Link className="h-primary" href={`/recipes/${suggestion.recipe.id}`}>
                  Open it
                </Link>
                <Link className="h-secondary" href={`/recipes?pick=${suggestion.next}`}>
                  Something else
                </Link>
              </div>
            </div>
          </article>
          <Link className="h-layout-more" href="/recipes?filter=untried">
            I&rsquo;ll choose myself
          </Link>
        </section>
      )}

      {/*
        * The flat list: every recipe, which is what a search or a filter wants and what the
        * deferred layouts fall back to. §77 — nothing live is dropped by a layout.
        */}
      {(searching || layout === "protein" || (layout === "decide" && !suggestion)) &&
        narrowed.map(({ recipe, matchedIngredient, allergenNotes }) => (
        <Link className="card" key={recipe.id} href={`/recipes/${recipe.id}`}>
          {photoFor.has(recipe.id) ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; the
            // optimiser would cache a URL that stops working before the cache does
            <img className="card-photo" src={photoFor.get(recipe.id)} alt="" loading="lazy" />
          ) : (
            // holds the grid square so a cookbook part-way through gaining photographs does not
            // look ragged
            <span className="card-photo none" aria-hidden="true">
              {recipe.title.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
          <div className="card-body">
          <h2>{recipe.title}</h2>
          {/*
            * `make_again` is a **state, not a count** — it is a boolean, and the reference's
            * "Will make again · 3" has no number behind it. A chip says the state and invents
            * nothing; §4's count would have needed schema §5 excludes.
            */}
          {recipe.make_again === true && <Chip tone="clay">Make again</Chip>}
          <p className="meta" style={{ margin: 0 }}>
            {[
              recipe.source_name,
              recipe.servings ? `serves ${recipe.servings}` : null,
              recipe.time_minutes ? `${recipe.time_minutes} min` : null,
              // "made 6×", which is §4's count and the one it asks for that already exists
              recipe.times_made ? `made ${recipe.times_made}×` : "untried",
              recipe.visibility === "public" ? "published" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {/* why this one is here, when the title says nothing about the search */}
          {/*
            * A warning, not a removal. These are the `unknown` readings: something bought
            * ready-made could plausibly carry it, and only a label settles it. Hiding them would
            * teach a household the app had read the label for them (§71).
            */}
          {allergenNotes?.map((note) => (
            <p className="matched" key={`${note.allergen}-${note.because}`}>
              {allergenSentence(note)}
            </p>
          ))}
          {matchedIngredient && (
            <p className="matched">contains {matchedIngredient}</p>
          )}
          <div className="card-actions">
            <ShortlistButton
              recipeId={recipe.id}
              weekStart={weekStart}
              nextWeekStart={nextWeekStart}
              shortlisted={onThisWeek.has(recipe.id)}
              shortlistedNext={onNextWeek.has(recipe.id)}
            />
          </div>
          </div>
        </Link>
      ))}
      </div>
    </main>
    {/*
      * Docked, never floating (§3, §5). `.h-docked-page` reserves its height so the last recipe
      * can be reached — a bar without that covers the final row, which is the bug a floating
      * button has in a different costume.
      */}
    <TabBar current="recipes" />
    </div>
  );
}
