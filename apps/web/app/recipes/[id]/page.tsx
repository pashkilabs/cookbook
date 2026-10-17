import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SUBSTITUTIONS, createSubstitutions, formatInSystem, isStaple, stripLeadingDecoration } from "@pashki/core";
import { INGREDIENT_COLUMNS } from "@pashki/db/catalog";
import { andList, energyForRecipe } from "@/lib/energy";
import { scaleIngredientAmounts, servingsForScale } from "@/lib/planner";
import { userClient } from "@/lib/supabase-server";
import { maybeRow, rows } from "@/lib/rows";
import { platformStore } from "@/lib/platform";
import { startOfWeek, addWeeks, todayIso, weekDays, weekLabel, weekdayName } from "@/lib/week";
import { PlanIt, type PlanDay } from "./plan-it";
import { ShortlistButton } from "../shortlist-button";
import { CookTonight } from "../cook-tonight";
import { RemoveRecipe } from "./remove";
import { Verdicts } from "./verdicts";
import { Preferences } from "./preferences";
import { PhotoUpload } from "../photo-upload";
import { PalateNotes } from "./palate";
import { SplitButton } from "../blend/split";
import { componentsKeyFor, palateNotesFor } from "@/lib/tastes";
import { Chip, IconLink, DockedActionBar, PrimaryLink, SecondaryLink } from "@/components/harvest";
import { allergenSentence, readAvoidedAllergens } from "@/lib/allergen-filter";
import { linkify } from "./linkify";
import { Substitution } from "./substitution";

/**
 * One recipe: what is in it, how to make it, who liked it, and what it looked like.
 *
 * Everything here already existed in the schema and none of it had ever been shown —
 * `recipe_steps` since the method became a child table (decisions §19), `ratings` since the
 * first migration, the photo since the storage bucket.
 *
 * **Filtered by `family_id`, not left to RLS.** Published recipes are world-readable
 * (decisions §17), so a policy would happily hand over a stranger's public recipe on a URL
 * guess. The filter is what makes an id that is not yours indistinguishable from an id that
 * does not exist — both are `notFound()`, and neither confirms the recipe is real.
 */
export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ planned?: string }>;
}) {
  const { id } = await params;
  const { planned } = await searchParams;
  const supabase = await userClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");

  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) redirect("/recipes");

  const recipe = maybeRow(
    await supabase
    .from("recipes")
    .select("id, title, source_name, source_url, servings, time_minutes, times_made, make_again, visibility, course, cuisine, dish_form, principal_protein, palate_notes, palate_key, components, components_key, components_agreement, components_readings, derived_at")
    .eq("id", id)
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .maybeSingle(),
    "recipe",
  );

  // an id belonging to another household lands here too, which is the point
  if (!recipe) notFound();

  /*
   * The stored partition, validated rather than cast.
   *
   * A jsonb column is whatever was last written into it, and this one is written by a model's
   * answer. Anything not shaped like a part is dropped rather than rendered as `undefined`.
   */
  const storedParts = (Array.isArray(recipe.components) ? recipe.components : [])
    .filter(
      (part): part is { name: string; role: string | null } =>
        typeof part === "object" && part !== null &&
        typeof (part as { name?: unknown }).name === "string" &&
        (part as { name: string }).name.trim().length > 0,
    )
    .map((part) => ({ name: part.name.trim(), role: typeof part.role === "string" ? part.role : null }));

  const [ingredients, steps, ratings, members, photo, catalogRows] = await Promise.all([
    supabase
      .from("recipe_ingredients")
      .select("id, position, amount, unit, item_text, note, is_estimated, section")
      .eq("recipe_id", id)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("recipe_steps")
      .select("id, position, text")
      .eq("recipe_id", id)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("ratings")
      .select("id, family_member_id, score")
      .eq("recipe_id", id)
      .is("deleted_at", null),
    platformStore().listMembers(family.id),
    supabase
      .from("photos")
      .select("storage_path, source, width, height")
      .eq("recipe_id", id)
      // the hero is a photograph of the food. A card is provenance and renders by the source
      // line instead — a page whose picture is an index card tells you nothing about dinner (§56)
      .neq("source", "source")
      .eq("upload_state", "stored")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // the catalog carries the energy figures; package sizes are about buying, not eating
    supabase.from("ingredients").select(INGREDIENT_COLUMNS),
  ]);

  /*
   * Is the stored partition an answer to *this* recipe, read by *this* prompt?
   *
   * Through `componentsKeyFor`, the same function `componentsFor` keys its cache with — a second
   * implementation here would drift and the drift would be invisible, because a key that never
   * matches reads as "not split yet" while the partition sits in the column.
   *
   * Cheap: a djb2 hash over the lines, no model and no network. Safe to compute on every view.
   */
  /*
   * What this recipe lets somebody have an opinion *about*.
   *
   * Its classification and its own ingredients, deduplicated and capped. Staples are dropped —
   * nobody states a preference about salt — and the cap exists because a nineteen-line recipe
   * would otherwise produce a select nobody scrolls. Ordered as the recipe lists them, because
   * that is the order the person reading it just saw.
   */
  const preferenceSubjects = (() => {
    const out: Array<{ kind: string; value: string; label: string }> = [];
    if (recipe.cuisine) out.push({ kind: "cuisine", value: recipe.cuisine, label: `${recipe.cuisine} food` });
    if (recipe.dish_form) out.push({ kind: "dish_form", value: recipe.dish_form, label: String(recipe.dish_form) });
    const seen = new Set<string>();
    for (const line of ingredients.data ?? []) {
      const text = (line.item_text ?? "").trim();
      if (!text || isStaple(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "ingredient", value: text, label: text });
      if (seen.size >= 14) break;
    }
    return out;
  })();

  /*
   * What has already been said about those subjects — scoped by `family_id` explicitly.
   *
   * RLS decides what may leave the database; a screen decides whose kitchen it shows, and those
   * are different questions. Filtered to this recipe's own subjects so the list under the control
   * is about what is on the page rather than everything the household has ever stated.
   */
  const statedRows = preferenceSubjects.length === 0 ? [] : rows(
    await supabase
      .from("member_preferences")
      .select("id, family_member_id, stance, subject, subject_kind")
      .eq("family_id", family.id)
      .is("deleted_at", null)
      .in("subject", preferenceSubjects.map((subject) => subject.value)),
    "stated preferences for this recipe",
  );
  const memberNames = new Map(members.map((member) => [member.id, member.displayName]));
  const statedPreferences = statedRows
    .filter((row) => memberNames.has(row.family_member_id as string))
    .map((row) => ({
      id: row.id as string,
      memberId: row.family_member_id as string,
      memberName: memberNames.get(row.family_member_id as string)!,
      stance: (row.stance === "like" ? "like" : "dislike") as "like" | "dislike",
      subject: row.subject as string,
      subjectKind: row.subject_kind as string,
    }));

  /*
   * Does this recipe name something the household avoids?
   *
   * **Opening it directly never refuses.** Somebody with the link asked for this recipe, and a
   * 404 for a recipe that exists is a worse answer than the recipe plus the reason. The list
   * hides it; this names it (§71).
   */
  const allergenNotes = (
    await readAvoidedAllergens(supabase, family.id, family.avoidedAllergens)
  ).byRecipe.get(recipe.id) ?? [];

  const partitionIsCurrent =
    typeof recipe.components_key === "string" &&
    // `.data ?? []` as everywhere else on this page. On a read failure the key is built from no
    // lines and cannot match, so the page offers to work the parts out rather than showing a
    // partition it could not verify — the safe direction of the two.
    recipe.components_key === componentsKeyFor(recipe, ingredients.data ?? []);

  // The bucket is private, so a URL has to be signed. Signed as the person viewing, so the
  // storage policy is what authorises it — the same reasoning as reading the rows.
  /*
   * Fetched separately from the hero rather than filtered out of one query: they are different
   * kinds with opposite publishing rules, and one query returning "whichever came back first"
   * is how a card would end up as a recipe's face.
   */
  let sourcePhotoUrl: string | null = null;
  {
    const card = maybeRow(
      await supabase
        .from("photos")
        .select("storage_path")
        .eq("recipe_id", id)
        .eq("source", "source")
        .eq("upload_state", "stored")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "source photo",
    );
    if (card?.storage_path) {
      const signed = await supabase.storage
        .from("recipe-photos")
        .createSignedUrl(card.storage_path as string, 600);
      sourcePhotoUrl = signed.data?.signedUrl ?? null;
    }
  }

  let photoUrl: string | null = null;
  if (photo.data?.storage_path) {
    const signed = await supabase.storage
      .from("recipe-photos")
      .createSignedUrl(photo.data.storage_path, 600);
    photoUrl = signed.data?.signedUrl ?? null;
  }

  /*
   * Opened from the planner, at the servings it was planned for.
   *
   * The scale is read from the plan entry rather than taken from the URL: a query parameter is a
   * caller's assertion, and a stale link would otherwise show amounts for a meal that has since
   * been changed. **Filtered by family_id as well as id** — the id comes from a URL, and RLS
   * returning nothing is not the same as this household owning it.
   */
  let plannedScale = 1;
  let plannedServings: number | null = null;
  if (planned) {
    const entry = maybeRow(
    await supabase
      .from("plan_entries")
      .select("scale, date")
      .eq("id", planned)
      .eq("family_id", family.id)
      .eq("recipe_id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    "entry",
  );
    if (entry) {
      plannedScale = Number(entry.scale) || 1;
      plannedServings = servingsForScale(plannedScale, recipe.servings);
    }
  }

  /*
   * Energy, at the scale this is being cooked.
   *
   * The multiplier cancels in the per-serving figure and survives in the total — cooking a roast
   * for nine does not make a serving of it more fattening. Coverage is partial and always will
   * be, so a recipe the catalog cannot fully price says so rather than quietly understating
   * itself (decisions §43).
   */
  const energy = energyForRecipe(ingredients.data ?? [], catalogRows.data ?? [], {
    servings: recipe.servings,
    scale: plannedScale,
  });

  /*
   * What to use instead, for the ingredients the table knows. Read here rather than through the
   * database: substitutions are domain knowledge and not operational data (§51), so they ship in
   * code and change by commit.
   */
  const substitutions = createSubstitutions(SUBSTITUTIONS);

  const scores = new Map(ratings.data?.map((r) => [r.family_member_id, r.score]) ?? []);

  const weekStart = startOfWeek(todayIso(family.timezone));
  // both weeks, because shortlisting only ever reached this one and the planner's waiting list
  // is week-scoped — so a recipe was stranded here while next week showed empty
  const nextWeekStart = addWeeks(weekStart, 1);
  /*
   * Both weeks, as rows rather than one row.
   *
   * `maybeSingle()` over two weeks throws the moment a recipe is on both lists — which is a
   * thing somebody may legitimately want — so this reads them and answers each button separately.
   */
  const shortlistRows = rows(
    await supabase
    .from("shortlist_entries")
    .select("week_start")
    .eq("family_id", family.id)
    .in("week_start", [weekStart, nextWeekStart])
    .eq("recipe_id", recipe.id)
    .is("deleted_at", null),
    "shortlisted",
  );

  /*
   * This recipe's own days this week, for the plan-it panel.
   *
   * Scoped to `recipe_id` — the panel answers "is THIS on Thursday", not "is anything". And to
   * `family_id` as well, for the reason the planned-entry read above gives: a row arriving from
   * somewhere else is not this household's.
   */
  const plannedDays = rows(
    await supabase
      .from("plan_entries")
      .select("id, date")
      .eq("family_id", family.id)
      .eq("recipe_id", recipe.id)
      .gte("date", weekStart)
      .lte("date", weekDays(weekStart)[6]!)
      .is("deleted_at", null),
    "planned days",
  );
  const entryByDate = new Map(plannedDays.map((row) => [row.date as string, row.id as string]));
  const today = todayIso(family.timezone);
  const planDays: PlanDay[] = weekDays(weekStart).map((date) => ({
    date,
    // in the household's timezone, like every other date decision here — a browser clock would
    // put today on a different circle for anybody whose device zone differs from the household's
    isToday: date === today,
    // the initial, which is what the reference's circles carry — and `weekdayName` is the one
    // place a day's name is spelled, so Tuesday and Thursday cannot drift apart from each other
    letter: weekdayName(date).charAt(0),
    dayOfMonth: Number(date.slice(8, 10)),
    entryId: entryByDate.get(date) ?? null,
    name: weekdayName(date),
  }));

  /*
   * Only when nobody in the household has rated it.
   *
   * Not a gate on the *feature* — §59 keeps the two ungated in principle — but a gate on this
   * render: where a child has actually said something about this dish, that is the better answer
   * and a generalisation beside it is noise. The fallback earns its place precisely where the
   * household is silent, which is a recipe nobody has tried.
   */
  const palate =
    (ratings.data ?? []).length === 0
      ? await palateNotesFor(supabase, recipe, ingredients.data ?? [])
      : [];

  return (
    <div className="h-docked-page">
    <main>
      {/*
        * Back as a 44px circle over the photograph (§4.2), not a text breadcrumb above it.
        *
        * `IconLink` requires a label, so it cannot ship nameless — which is the failure an
        * icon-only control has and a text link does not.
        */}

      {/*
        * The photograph leads. It is what a person recognises the dish by, and putting it under
        * the title made it look like an attachment to a database row.
        */}
      <div className="h-hero">
        <IconLink label={`Back to ${family.name}`} href="/recipes" className="h-hero-back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </IconLink>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed URL expires; the
        // optimiser would cache one past its life
        <img
          src={photoUrl}
          alt=""
          className="photo hero"
          width={photo.data?.width ?? undefined}
          height={photo.data?.height ?? undefined}
        />
      ) : (
        /* one wash for a missing image, not a placeholder tint — see the Phase 0 recon */
        <span className="h-hero-empty" aria-hidden="true">
          {recipe.title.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
      </div>

      {/* the placement Stephen was reaching for: an existing recipe with no picture had no way
          to get one, on any screen. Labelled by what it does to the recipe you can see. */}
      {/*
        * A blend says so, first, before anything it might be mistaken for.
        *
        * §60: a blend is a proposal, marked untried, visually unlike an ordinary recipe. The one
        * thing it must never be taken for is something somebody has cooked — and `times_made`
        * cannot carry that, because an ordinary recipe nobody has made yet is also 0.
        */}
      {recipe.derived_at !== null && (
        <aside className="proposal">
          <h2>{recipe.times_made > 0 ? "A blend you have cooked" : "A proposal. Nobody has cooked this."}</h2>
          <p>
            Assembled from parts of two of your own recipes, with every quantity exactly as its
            own recipe wrote it. Nothing was rebalanced for the pairing, two lines wanting the
            same thing stay two lines, and each method below is reproduced whole —{" "}
            <strong>including steps for ingredients this blend does not use.</strong>
          </p>
          <p className="meta">
            Your shopping list still combines duplicates properly across the week; the
            duplication is confined to this page. A blend stays private whatever the sharing
            settings say.
          </p>
        </aside>
      )}

      {/* the general-knowledge half, kept apart from any observation (§57a) */}
      <PalateNotes notes={palate} />

      <PhotoUpload recipeId={recipe.id} label={photoUrl ? "Replace the photo" : "Add a photo"} />

      {/*
        * The parchment sheet, overlapping the hero by 22px (§4.2).
        *
        * It is what makes the photograph part of the page rather than a banner above it — the
        * recipe begins on paper laid over the picture. `--radius-sheet` is the token for the
        * corner, and the negative margin is the overlap the reference draws.
        */}
      <div className="h-sheet">
        {/*
          * Above everything, because the point of it is the decision to cook — not a footnote
          * discovered after reading the method. Worded as §71 requires: what it saw, quoted, and
          * never the word "safe".
          *
          * It is at the top of the sheet now rather than nested inside the old header bar's title
          * column, which is where a careless insertion had put it: a <section> inside a flex child
          * meant to hold an <h1>. It rendered, which is why nothing noticed.
          */}
        {allergenNotes.length > 0 && (
          <section className="allergen-warning">
            {allergenNotes.map((note) => (
              <p key={`${note.allergen}-${note.because}`}>
                <strong>{allergenSentence(note)}</strong>
              </p>
            ))}
            <p className="meta">
              Your household avoids {andList(family.avoidedAllergens.map((a) => (a === "tree-nut" ? "tree nuts" : a)))},
              so this is hidden from the recipe list and from search. It reads ingredient lists, so
              it cannot see inside a jar.
            </p>
          </section>
        )}

        {/*
          * Chips: what the recipe IS. Drawn from the classification the app already has — course,
          * cuisine, dish form, protein — rather than from a tag column it does not.
          *
          * "Will make again · 3" in the reference has no number behind it: `make_again` is a
          * boolean, so this says the state and invents nothing.
          */}
        <div className="h-chips">
          {recipe.time_minutes && <Chip>{recipe.time_minutes} min</Chip>}
          {recipe.cuisine && <Chip>{recipe.cuisine}</Chip>}
          {recipe.dish_form && <Chip>{String(recipe.dish_form)}</Chip>}
          {recipe.principal_protein && <Chip>{String(recipe.principal_protein)}</Chip>}
          {recipe.make_again === true && <Chip tone="clay">Make again</Chip>}
          {recipe.times_made > 0 && <Chip tone="clay">Made {recipe.times_made}×</Chip>}
        </div>

        <h1 className="h-recipe-title">{recipe.title}</h1>

        {/*
          * Source attribution on every imported recipe (§4.2), and it is the one part of this
          * screen with a reason beyond style: §open lists the copyright posture as unsettled, and
          * a link back to whoever wrote it is the least this can do meanwhile.
          *
          * The domain is shown rather than the full URL — "instagram.com" is what tells somebody
          * where it came from, and a 200-character share link is not.
          */}
        {(recipe.source_name || recipe.source_url) && (
          <p className="h-source">
            {recipe.source_url ? (
              <a href={recipe.source_url} target="_blank" rel="noopener noreferrer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
                {recipe.source_name ? `From ${recipe.source_name}` : "Source"}
                {(() => {
                  try {
                    return ` · ${new URL(recipe.source_url).hostname.replace(/^www\./, "")}`;
                  } catch {
                    // a stored URL that will not parse is still worth attributing by name
                    return "";
                  }
                })()}
              </a>
            ) : (
              <span className="meta">From {recipe.source_name}</span>
            )}
          </p>
        )}

        {/*
          * The actions that were a row of five buttons in the header.
          *
          * Edit, Pair and Remove stay here as quiet links; the two a person actually came for —
          * cook it, or put it on the week — are in the docked bar at the foot, which is where §3
          * puts a primary action and where a thumb is.
          */}
        <div className="h-row-quiet">
          <Link className="button quiet" href={`/recipes/blend?from=${recipe.id}`}>
            Pair this with…
          </Link>
          <Link className="button quiet" href={`/recipes/${recipe.id}/edit`}>
            Edit
          </Link>
          <RemoveRecipe recipeId={recipe.id} title={recipe.title} />
        </div>
      </div>

      {plannedScale !== 1 && (
        <div className="notice">
          Amounts shown for <strong>{plannedServings ?? `${plannedScale}×`} servings</strong>, as
          planned. <Link href={`/recipes/${recipe.id}`}>Show the recipe as written</Link>.
        </div>
      )}

      <section>
        <h2>Ingredients</h2>

        {/*
          * An approximation, and it says so. "at least" is load-bearing: a partial total is a
          * lower bound, and somebody reading a bare number would take it as the answer.
          */}
        {energy && (
          <p className="meta energy">
            {energy.stated ? (
              <>
                <strong>
                  {energy.isFloor ? "at least " : ""}~
                  {energy.perServing ?? energy.total} kcal
                </strong>{" "}
                {energy.perServing === null
                  ? "in total"
                  : `per serving, ~${energy.total} in total`}
                {energy.unknown.length > 0 && (
                  <> — no figure yet for {andList(energy.unknown)}</>
                )}
              </>
            ) : (
              <>
                No calorie estimate — the catalog has no figure for{" "}
                {andList(energy.unknown)}
              </>
            )}
          </p>
        )}

        {ingredients.data?.length ? (
          (() => {
            const lines = scaleIngredientAmounts(ingredients.data, plannedScale);

            /*
             * The recipe's own headings, in the order it wrote them.
             *
             * `section` has been persisted since §60 step 1 and no screen selected it, so a
             * recipe imported with "For the sauce:" rendered as one flat list with the heading
             * silently gone. Storing a column and never showing it is the same shape as an
             * endpoint with no way in from the product: every test passed, and the feature was
             * not there.
             *
             * A recipe with no headings — still most of them — takes the single-list branch and
             * looks exactly as it did.
             */
            const groups: Array<{ heading: string | null; lines: typeof lines }> = [];
            for (const line of lines) {
              const heading = line.section ?? null;
              const last = groups[groups.length - 1];
              if (last && last.heading === heading) last.lines.push(line);
              else groups.push({ heading, lines: [line] });
            }

            const renderLine = (line: (typeof lines)[number]) => {
              /*
               * In the household's units (§47). Read-only, so it converts — the editor and the
               * import review must not, because they re-parse what they show and would rewrite
               * the recipe on save. A household whose units match the recipe's sees no change.
               */
              const measure = formatInSystem(
                line.amount === null ? null : Number(line.amount),
                line.unit,
                family.measurementSystem,
              );
              return (
                <li key={line.id}>
                  {measure && <span className="measure">{measure}</span>}
                  <span>{line.item_text}</span>
                  {line.note && <span className="meta"> — {line.note}</span>}
                  {(() => {
                    const swap = substitutions.find(line.item_text);
                    return swap ? <Substitution entry={swap} /> : null;
                  })()}
                  {line.is_estimated && (
                    <span className="estimated" title="This amount was inferred, not stated">
                      estimated
                    </span>
                  )}
                </li>
              );
            };

            return groups.length === 1 && groups[0]!.heading === null ? (
              <ul className="ingredients">{groups[0]!.lines.map(renderLine)}</ul>
            ) : (
              groups.map((group, at) => (
                <div key={group.heading ?? `unheaded-${at}`}>
                  {group.heading && <h3 className="ingredient-heading">{group.heading}</h3>}
                  <ul className="ingredients">{group.lines.map(renderLine)}</ul>
                </div>
              ))
            );
          })()
        ) : (
          <p className="meta">No ingredients recorded.</p>
        )}
      </section>

      {/*
        * The parts this recipe splits into — §60 step 2, reachable at last.
        *
        * Shown, never acted on. §61 measured the agreement number against thirty hand-labelled
        * recipes and found it separates a right partition from a wrong one at 50/50, because
        * three runs of one model at temperature zero are one opinion sampled three times and
        * fail together. So this is an observation a person can weigh, in the taste-readings
        * shape, and the sentence under it says plainly that nothing has checked the boundaries.
        *
        * Low agreement is still worth saying: if two readings disagree at least one is wrong,
        * necessarily. Agreement proves nothing in the other direction, so it is never shown as
        * a credential.
        */}
      {/*
        * A control, on the recipe — and the reason it is a control.
        *
        * The display below has been here since §60 and nothing on this page could *produce* it:
        * a partition only existed if somebody had gone to the blend composer and asked for one,
        * which is the rarest reason to want it. So the capability was reachable only from the
        * screen for the use nobody has yet — the eighth thing shipped without a way in, and this
        * one had its display already built.
        *
        * Not automatic on load. Three model calls, twelve to thirty seconds each, and the
        * overwhelming majority of recipe views do not want a partition — auto-computing would be
        * the import trigger's cost spread thinner, paid on every recipe anybody opens rather
        * than at import. `SplitButton` is reused rather than reimplemented: it already says what
        * the wait is for, disables itself so a second click cannot spend a second three calls,
        * and separates "read as one thing" from "only one reading came back".
        *
        * **Three states, because stale is not the same as absent.** The stored partition is an
        * answer to a prompt and a list of lines; either can have changed since. Showing a stale
        * partition as current is the failure the version fingerprint exists to prevent — it was
        * live for a week, and six households' recipes read `protein / garnish / carbohydrate`
        * from a prompt that had been replaced.
        */}
      {storedParts.length > 0 && !partitionIsCurrent && (
        <section>
          <h2>This recipe splits into</h2>
          <p className="meta">
            The recipe or the way it is read has changed since these parts were worked out, so
            they are not shown — a stale split looks exactly like a fresh one, which is worse
            than none.
          </p>
          <SplitButton recipeId={recipe.id} label="Work out the parts again" />
        </section>
      )}

      {storedParts.length === 0 && (
        <section>
          <h2>Parts of this recipe</h2>
          <p className="meta">
            Which bits were cooked separately — the sauce, the protein, the grain. Worth knowing
            if you want to make one part in a batch, or pair it with something else. Reading it
            takes under a minute and only happens when you ask.
          </p>
          <SplitButton recipeId={recipe.id} label="Work out the parts" />
        </section>
      )}

      {storedParts.length > 0 && partitionIsCurrent && (
        <section>
          <h2>This recipe splits into</h2>
          <p>
            {storedParts.map((part, at) => (
              <span key={`${part.name}-${at}`}>
                {at > 0 ? " · " : ""}
                <strong>{part.name}</strong>
                {part.role && <span className="meta"> ({part.role})</span>}
              </span>
            ))}
          </p>
          <p className="meta">
            How the model read it. <strong>Nothing has checked that these are the right
            boundaries</strong> — a person looking at them is what does that, which is why
            pairing one with another recipe lets you move them line by line.
            {typeof recipe.components_agreement === "number" && recipe.components_agreement < 0.7
              ? " The three readings disagreed about where the parts divide, so treat this as a rough guess."
              : ""}
          </p>
          <p>
            <Link className="button quiet" href={`/recipes/blend?from=${recipe.id}`}>
              Pair a part of this with another recipe
            </Link>
          </p>
        </section>
      )}

      {/*
        * Where it came from, on every recipe that has it.
        *
        * `source_url` was only ever shown when a recipe had no steps, so an imported recipe with
        * a method hid its own provenance — the copyright posture is unresolved (§open) and a link
        * back to the source is the least this can do meanwhile.
        */}
      {/*
        * What the browse screen sorts by, shown where a person can see it.
        *
        * These were written on every import and displayed nowhere, so a wrong course was
        * invisible unless somebody opened the edit screen — and "work these out again" appeared
        * to do nothing because the page it refreshed never showed its result. A field nobody can
        * see is a field nobody can correct.
        *
        * Quiet metadata rather than a feature: this is how the recipe is filed, not what it is.
        */}
      {(recipe.course || recipe.cuisine || recipe.dish_form || recipe.principal_protein) && (
        <p className="meta" style={{ marginBottom: "0.75rem" }}>
          {[recipe.course, recipe.cuisine, recipe.dish_form, recipe.principal_protein]
            .filter(Boolean)
            .map((value) => String(value)[0]!.toUpperCase() + String(value).slice(1))
            .join(" · ")}{" "}
          <a href={`/recipes/${recipe.id}/edit`}>edit</a>
        </p>
      )}

      {recipe.source_url && (
        <p className="meta" style={{ marginBottom: "1.5rem" }}>
          From{" "}
          <a href={recipe.source_url} target="_blank" rel="noopener noreferrer">
            {recipe.source_name || new URL(recipe.source_url).hostname.replace(/^www\./, "")}
          </a>
        </p>
      )}

      {/*
        * The card this was read from — provenance, beside the source line rather than at the top.
        *
        * It answers "is this really what Grandma wrote", which is a different question from
        * "what does it look like", and it is the question a handwritten card raises. A collapsed
        * disclosure because most visits are somebody cooking, who wants the method; the card is
        * for the visit where a quantity looks wrong.
        *
        * Never published, whatever this recipe's visibility (§56): a photograph of a printed page
        * carries someone else's copyright, and the policies enforce that independently of this.
        */}
      {sourcePhotoUrl && (
        <details style={{ marginBottom: "1.5rem" }}>
          <summary className="meta">The card this came from</summary>
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL expires */}
          <img src={sourcePhotoUrl} alt="" className="photo" style={{ marginTop: "0.75rem" }} />
        </details>
      )}

      <section>
        <h2>Method</h2>
        {steps.data?.length ? (
          <ol className="steps">
            {/* linked and de-decorated at render time; the stored text stays as the source wrote it */}
            {steps.data.map((step) => (
              <li key={step.id}>{linkify(stripLeadingDecoration(step.text))}</li>
            ))}
          </ol>
        ) : (
          <p className="meta">
            No method recorded. Imported recipes link back to the source rather than
            reproducing it — see decisions §19.
            {recipe.source_url && (
              <>
                {" "}
                <a href={recipe.source_url} rel="noreferrer noopener" target="_blank">
                  Open the original
                </a>
                .
              </>
            )}
          </p>
        )}
      </section>

      <Verdicts
        recipeId={recipe.id}
        familyId={family.id}
        makeAgain={recipe.make_again}
        members={members.map((member) => ({
          id: member.id,
          displayName: member.displayName,
          birthYear: member.birthYear,
          isChild: member.isChild,
          score: scores.get(member.id) ?? null,
        }))}
      />

      {/*
        * In the same breath as the rating, and that is the whole design.
        *
        * A preference recorded at the moment an opinion exists is one that gets recorded — the
        * reasoning that put rating inline with "Cooked it". Nobody navigates to a settings screen
        * to announce that Ada does not like mushrooms; they find it out at dinner, a second after
        * giving the recipe a 2.
        *
        * The subjects offered are *this recipe's own*, so nothing invites an opinion about
        * something that is not in front of you.
        */}
      {/*
        * `CookTonight` sits beside the panel rather than inside it: tapping today's circle does
        * the same thing, and this is the labelled one-tap version for somebody who has already
        * decided. Kept because it is a live feature — the restyle does not get to drop one — and
        * because "tap the circle with a ring round it" is a thing you have to notice first.
        */}
      <div className="h-row-quiet" style={{ marginTop: "var(--space-lg)" }}>
        <CookTonight recipeId={recipe.id} today={today} />
      </div>
      <PlanIt recipeId={recipe.id} weekLabel={weekLabel(weekStart)} days={planDays} />

      <Preferences
        members={members.map((member) => ({ id: member.id, displayName: member.displayName }))}
        subjects={preferenceSubjects}
        stated={statedPreferences}
      />
    </main>

    {/*
      * The docked bar (§4.2), and one deliberate deviation from the reference.
      *
      * It asks for "Add N to list" beside "Cook now". **This app has no list to add to**: the
      * shopping list is *derived* from what is planned — `buildShoppingWeek` reads `plan_entries`
      * — and that derivation is the whole product. One pint of cream across Tuesday and Friday
      * exists because the list is computed from a week, not accumulated by taps.
      *
      * So the secondary action is the real one: put it on the week, and the ingredients follow.
      * An "Add to list" button would have to either create a plan entry (which is what
      * "Make this week" already is) or write a second kind of list that consolidation could not
      * see — and that second list is precisely what this app exists instead of.
      *
      * `ShortlistButton` and `CookTonight` are the existing controls, unchanged in behaviour and
      * moved to where a thumb is.
      */}
    <DockedActionBar>
      <ShortlistButton
        recipeId={recipe.id}
        weekStart={weekStart}
        nextWeekStart={nextWeekStart}
        shortlisted={shortlistRows.some((row) => row.week_start === weekStart)}
        shortlistedNext={shortlistRows.some((row) => row.week_start === nextWeekStart)}
      />
      {/*
        * The reference's "Cook now", and it is the primary because it is the only action here that
        * is about the next ten minutes rather than about the week.
        *
        * `?planned=` is carried through so cook mode shows the amounts this page is showing. A
        * cook screen quietly reverting to the unscaled recipe is the worst way for this to be
        * wrong, because nothing on it would look wrong.
        */}
      <PrimaryLink href={planned ? `/cook/${recipe.id}?planned=${planned}` : `/cook/${recipe.id}`}>
        Cook now
      </PrimaryLink>
    </DockedActionBar>
    </div>
  );
}
