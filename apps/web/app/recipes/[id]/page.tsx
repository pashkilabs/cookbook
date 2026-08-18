import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SUBSTITUTIONS, createSubstitutions, formatInSystem, stripLeadingDecoration } from "@pashki/core";
import { INGREDIENT_COLUMNS } from "@pashki/db/catalog";
import { andList, energyForRecipe } from "@/lib/energy";
import { scaleIngredientAmounts, servingsForScale } from "@/lib/planner";
import { userClient } from "@/lib/supabase-server";
import { maybeRow, rows } from "@/lib/rows";
import { platformStore } from "@/lib/platform";
import { startOfWeek, todayIso } from "@/lib/week";
import { ShortlistButton } from "../shortlist-button";
import { RemoveRecipe } from "./remove";
import { Verdicts } from "./verdicts";
import { PhotoUpload } from "../photo-upload";
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
    .select("id, title, source_name, source_url, servings, time_minutes, times_made, make_again, visibility")
    .eq("id", id)
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .maybeSingle(),
    "recipe",
  );

  // an id belonging to another household lands here too, which is the point
  if (!recipe) notFound();

  const [ingredients, steps, ratings, members, photo, catalogRows] = await Promise.all([
    supabase
      .from("recipe_ingredients")
      .select("id, position, amount, unit, item_text, note, is_estimated")
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
      .eq("upload_state", "stored")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // the catalog carries the energy figures; package sizes are about buying, not eating
    supabase.from("ingredients").select(INGREDIENT_COLUMNS),
  ]);

  // The bucket is private, so a URL has to be signed. Signed as the person viewing, so the
  // storage policy is what authorises it — the same reasoning as reading the rows.
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

  const weekStart = startOfWeek(todayIso());
  const shortlisted = maybeRow(
    await supabase
    .from("shortlist_entries")
    .select("id")
    .eq("family_id", family.id)
    .eq("week_start", weekStart)
    .eq("recipe_id", recipe.id)
    .is("deleted_at", null)
    .maybeSingle(),
    "shortlisted",
  );

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: "0.75rem" }}>
        <Link href="/recipes">← {family.name}</Link>
      </p>

      {/*
        * The photograph leads. It is what a person recognises the dish by, and putting it under
        * the title made it look like an attachment to a database row.
        */}
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed URL expires; the
        // optimiser would cache one past its life
        <img
          src={photoUrl}
          alt=""
          className="photo hero"
          width={photo.data?.width ?? undefined}
          height={photo.data?.height ?? undefined}
        />
      )}

      {/* the placement Stephen was reaching for: an existing recipe with no picture had no way
          to get one, on any screen. Labelled by what it does to the recipe you can see. */}
      <PhotoUpload recipeId={recipe.id} label={photoUrl ? "Replace the photo" : "Add a photo"} />

      <div className="bar" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1>{recipe.title}</h1>
          <ul className="facts">
            {[
              recipe.source_name,
              recipe.servings ? `serves ${recipe.servings}` : null,
              recipe.time_minutes ? `${recipe.time_minutes} min` : null,
              recipe.times_made ? `made ${recipe.times_made}×` : null,
              recipe.visibility === "public" ? "published" : null,
            ]
              .filter(Boolean)
              .map((fact) => <li key={String(fact)}>{fact}</li>)}
          </ul>
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          <ShortlistButton
            recipeId={recipe.id}
            weekStart={weekStart}
            shortlisted={shortlisted !== null}
          />
          <Link className="button" href={`/recipes/${recipe.id}/edit`}>
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
          <ul className="ingredients">
            {scaleIngredientAmounts(ingredients.data, plannedScale).map((line) => {
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
            })}
          </ul>
        ) : (
          <p className="meta">No ingredients recorded.</p>
        )}
      </section>

      {/*
        * Where it came from, on every recipe that has it.
        *
        * `source_url` was only ever shown when a recipe had no steps, so an imported recipe with
        * a method hid its own provenance — the copyright posture is unresolved (§open) and a link
        * back to the source is the least this can do meanwhile.
        */}
      {recipe.source_url && (
        <p className="meta" style={{ marginBottom: "1.5rem" }}>
          From{" "}
          <a href={recipe.source_url} target="_blank" rel="noopener noreferrer">
            {recipe.source_name || new URL(recipe.source_url).hostname.replace(/^www\./, "")}
          </a>
        </p>
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
          isChild: member.isChild,
          score: scores.get(member.id) ?? null,
        }))}
      />
    </main>
  );
}
