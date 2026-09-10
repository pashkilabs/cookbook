import Link from "next/link";
import { redirect } from "next/navigation";
import { composeBlend, formatAsWritten, servingsDisagreement, collagenWarnings } from "@pashki/core";
import { userClient } from "@/lib/supabase-server";
import { platformStore } from "@/lib/platform";
import { offerFor, type BlendOffer } from "@/lib/blends";
import { searchRecipes } from "@/lib/recipe-search";
import { PartPicker, type PickerLine } from "./part-picker";
import { SplitButton } from "./split";
import { SaveBlend, type SavePart } from "./save";

/**
 * Pair a part of one recipe with a part of another (§60 step 4).
 *
 * A top-level route rather than `/recipes/[id]/blend`, and not for tidiness:
 * `scripts/check-routes-reachable.mjs` skips any route whose path contains `[`, so a nested
 * composer would get no reachability coverage at all — and an unreachable feature with a
 * passing check is the failure this project keeps meeting.
 *
 * **All state in the URL.** Four stages, each a link away, following the import screen. A
 * half-made blend survives the back button, and nothing is stored until the proposal is saved.
 *
 * Filtered by `family_id` at every read, never left to RLS: published recipes are world-readable
 * by design (§17), so a policy would happily hand over a stranger's recipe on a URL guess.
 */
export default async function BlendPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const supabase = await userClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");
  const family = await platformStore().findFamilyForAccount(auth.user.id);
  if (!family) redirect("/recipes");

  const from = query.from ?? "";
  if (!from) redirect("/recipes");

  // no inference in a render: splitting is behind the button, so a reload costs nothing
  const source = await offerFor(supabase, family.id, from);
  // an id belonging to another household lands here too, which is the point
  if (!source) redirect("/recipes");
  if (source.isBlend) {
    return (
      <main>
        <p className="subtitle">
          <Link href={`/recipes/${from}`}>Back to the recipe</Link>
        </p>
        <h1>That one is already a blend</h1>
        <p className="meta">
          A blend cannot be built on a blend. Its parts were proposed rather than declared, and
          building on them would let one guess be read as evidence for the next.
        </p>
      </main>
    );
  }

  const takeA = readSelection(query.take, query.lines, query.adj, source);
  const withId = query.with ?? "";
  const other = withId ? await offerFor(supabase, family.id, withId) : null;
  const takeB = other ? readSelection(query.take2, query.lines2, query.adj2, other) : null;

  const crumb = (
    <p className="subtitle">
      <Link href={`/recipes/${from}`}>Back to “{source.title}”</Link>
    </p>
  );

  // ---- Stage A: which part of the first recipe? -----------------------------
  if (!takeA) {
    return (
      <main>
        {crumb}
        <h1>Pair this with something</h1>
        <PartPicker
          heading={`Which part of “${source.title}” are you keeping?`}
          action="Choose what to pair it with"
          continueBase={`/recipes/blend?from=${encodeURIComponent(from)}`}
          slot=""
          lines={pickerLines(source)}
          parts={source.parts}
          onlyWholeBecause={source.onlyWholeBecause}
          split={source.parts.length < 2 ? <SplitButton recipeId={source.recipeId} label="Split it into parts" /> : null}
        />
      </main>
    );
  }

  const base = `/recipes/blend?from=${encodeURIComponent(from)}&take=${encodeURIComponent(query.take ?? "whole")}&lines=${encodeURIComponent(query.lines ?? "")}${query.adj ? "&adj=1" : ""}`;

  // ---- Stage B: which recipe to pair it with? ------------------------------
  if (!other) {
    const search = await searchRecipes({
      supabase,
      familyId: family.id,
      query: query.q ?? "",
      filter: null,
    });
    // the existing family-scoped search, reused where it stands rather than a second door onto
    // the recipe list — which is what /recipes/browse was deleted for
    const hits = search.hits.filter((hit) => hit.recipe.id !== from);
    return (
      <main>
        {crumb}
        <h1>Pair “{takeA.name}” with</h1>
        <form method="get" action="/recipes/blend" className="tabs">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="take" value={query.take ?? "whole"} />
          <input type="hidden" name="lines" value={query.lines ?? ""} />
          {query.adj && <input type="hidden" name="adj" value="1" />}
          <input name="q" defaultValue={query.q ?? ""} placeholder="Search your recipes" aria-label="search" />
          <button className="button quiet" type="submit">Search</button>
        </form>
        {search.error && <p className="meta">{search.error}</p>}
        {hits.length === 0 ? (
          <p className="meta">
            {query.q ? `Nothing matched “${query.q}”.` : "No other recipes yet."}
          </p>
        ) : (
          <ul className="ingredients">
            {hits.map((hit) => (
              <li key={hit.recipe.id}>
                <Link href={`${base}&with=${encodeURIComponent(hit.recipe.id)}`}>
                  {hit.recipe.title}
                </Link>
                {hit.recipe.source_name && (
                  <span className="meta"> · {hit.recipe.source_name}</span>
                )}
                {hit.matchedIngredient && (
                  <span className="meta"> · matched on {hit.matchedIngredient}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  if (other.isBlend) {
    return (
      <main>
        {crumb}
        <h1>“{other.title}” is already a blend</h1>
        <p className="meta">A blend cannot be built on a blend. Pick an ordinary recipe.</p>
        <p><Link href={base}>Choose a different one</Link></p>
      </main>
    );
  }

  // ---- Stage C: which part of the second recipe? ---------------------------
  if (!takeB) {
    return (
      <main>
        {crumb}
        <h1>Pair “{takeA.name}” with “{other.title}”</h1>
        <PartPicker
          heading={`Which part of “${other.title}” are you taking?`}
          action="See the proposal"
          continueBase={`${base}&with=${encodeURIComponent(withId)}`}
          slot="2"
          lines={pickerLines(other)}
          parts={other.parts}
          onlyWholeBecause={other.onlyWholeBecause}
          split={other.parts.length < 2 ? <SplitButton recipeId={other.recipeId} label="Split it into parts" /> : null}
        />
      </main>
    );
  }

  // ---- Stage D: the proposal, exactly as it will be stored -----------------
  const parts = [
    { offer: source, take: takeA },
    { offer: other, take: takeB },
  ];

  const composed = composeBlend(
    parts.map(({ offer, take }) => ({
      sourceRecipeId: offer.recipeId,
      sourceTitle: offer.title,
      componentName: take.name,
      role: take.role,
      taken: take.taken,
      adjusted: take.adjusted,
      agreement: take.agreement,
      readings: take.readings,
      ingredients: take.lineIndexes.map((index) => {
        const line = offer.lines[index]!;
        return {
          amount: line.amount,
          unit: line.unit,
          itemText: line.itemText,
          note: line.note,
          isEstimated: line.isEstimated,
          section: line.section,
        };
      }),
      steps: [] as string[],
    })),
  );

  const disagreement = servingsDisagreement(
    parts.map(({ offer, take }) => ({ componentName: take.name, servings: offer.servings })),
  );

  const savePayload: SavePart[] = parts.map(({ offer, take }) => ({
    sourceRecipeId: offer.recipeId,
    componentName: take.name,
    role: take.role,
    taken: take.taken,
    lineIndexes: take.lineIndexes,
    adjusted: take.adjusted,
  }));

  return (
    <main>
      {crumb}
      <h1>{takeA.name} with {takeB.name}</h1>

      {/*
        * Its own block, its own attribution line before any claim — the palate-note shape (§57a).
        * A blend must be visually unlike an ordinary recipe, because the one thing it must never
        * be mistaken for is something somebody has cooked.
        */}
      <aside className="proposal">
        <h2>A proposal. Nobody has cooked this.</h2>
        <p>
          Assembled from two of your own recipes. <strong>Every quantity is exactly as its own
          recipe wrote it</strong> — nothing here has been rebalanced for the pairing, and two
          lines wanting the same thing stay two lines. Your shopping list still combines them
          properly across the week; the duplication is confined to this page.
        </p>
        <p>
          It stays private. A blend reproduces two other people’s prose, so it is never published
          whatever the sharing settings say.
        </p>
      </aside>

      <section>
        <h2>Serves</h2>
        {disagreement ? (
          <p className="meta">
            Not stated.{" "}
            {disagreement.map((part, at) => (
              <span key={part.componentName}>
                {at > 0 ? " and " : ""}
                {part.componentName} is written for {part.servings}
              </span>
            ))}
            . Nothing has reconciled them, because this combines parts as written. Plan it by
            multiplier instead.
          </p>
        ) : (
          <p className="meta">Not stated — plan it by multiplier.</p>
        )}
      </section>

      <section>
        <h2>Ingredients</h2>
        <IngredientGroups composed={composed} />
      </section>

      <section>
        <h2>Method</h2>
        <p className="meta">
          <strong>Nothing here knows which steps make which part.</strong> When you save this,
          each recipe’s method is reproduced whole, as it wrote it — <em>including the steps for
          ingredients this blend does not use.</em> Working out which to follow is yours, and that
          is what makes this a proposal rather than a recipe. Technique extraction is not built:
          the corpus does not contain enough of it to measure against (§60).
        </p>
      </section>

      <Chemistry composed={composed} />

      <SaveBlend title={`${takeA.name} with ${takeB.name}`} parts={savePayload} />
    </main>
  );
}

/** the composed lines, under the heading of the part each came from */
function IngredientGroups({ composed }: { composed: ReturnType<typeof composeBlend> }) {
  return (
    <>
      {composed.parts.map((part) => (
        <div key={`${part.sourceRecipeId}-${part.ingredientsFrom}`}>
          <h3 className="ingredient-heading">
            {part.componentName} · from {part.sourceTitle}
          </h3>
          <ul className="ingredients">
            {composed.ingredients
              .slice(part.ingredientsFrom, part.ingredientsTo + 1)
              .map((line) => (
                <li key={line.position}>
                  {formatAsWritten(line.amount, line.unit) && (
                    <span className="measure">{formatAsWritten(line.amount, line.unit)}</span>
                  )}
                  <span>{line.itemText}</span>
                  {line.note && <span className="meta"> — {line.note}</span>}
                  {line.isEstimated && (
                    <span className="estimated" title="This amount was inferred, not stated">
                      estimated
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/**
 * The one thing with a temperature behind it, and the three ways it can have nothing to say.
 *
 * Silence is rendered as a sentence rather than as an empty block, because an empty block is
 * indistinguishable from a check that never ran — which is the failure this project keeps
 * meeting. The only unremarked silence is "no such cut", and it is honest because no question
 * was asked.
 */
function Chemistry({ composed }: { composed: ReturnType<typeof composeBlend> }) {
  const readings = composed.parts.map((part) => {
    const lines = composed.ingredients
      .slice(part.ingredientsFrom, part.ingredientsTo + 1)
      .map((line) => [line.amount ?? "", line.unit ?? "", line.itemText].join(" ").trim());
    // per part, not per blend: a collagen cut brought from its own braise reads as fine, and
    // scoping the check to the whole dish would let one part's long cook silence another's
    return { part, warnings: collagenWarnings({ ingredients: lines, steps: [] }) };
  });

  const said = readings.filter((reading) => reading.warnings.length > 0);
  return (
    <section>
      <h2>What the chemistry says</h2>
      {said.length === 0 ? (
        <p className="meta">
          Nothing to flag. This checks one thing — a collagen-rich cut given minutes rather than
          the hours it needs — and most pairings have no published basis either way, so saying
          nothing is the usual answer rather than a clean bill of health.
        </p>
      ) : (
        said.map((reading) =>
          reading.warnings.map((warning) => (
            <p key={`${reading.part.componentName}-${warning.subject}`}>
              <span className="estimated">mechanism</span> <strong>{warning.subject}</strong> —{" "}
              {warning.note}
            </p>
          )),
        )
      )}
    </section>
  );
}

function pickerLines(offer: BlendOffer): PickerLine[] {
  return offer.lines.map((line) => ({
    index: line.index,
    measure: formatAsWritten(line.amount, line.unit) ?? "",
    itemText: line.itemText,
    note: line.note,
    section: line.section,
  }));
}

/**
 * A selection from the URL, checked against the recipe it claims to be from.
 *
 * A line number that no longer exists is dropped rather than trusted: the recipe may have been
 * edited in another tab since the link was made, and an index into a list that has changed is
 * the stale-pointer failure the lineage keys exist to catch.
 */
function readSelection(
  key: string | undefined,
  lines: string | undefined,
  adjusted: string | undefined,
  offer: BlendOffer,
): { name: string; role: string | null; taken: "component" | "whole"; lineIndexes: number[]; adjusted: boolean; agreement: number | null; readings: number | null } | null {
  if (!key || lines === undefined) return null;
  const part = offer.parts.find((candidate) => candidate.key === key);
  if (!part) return null;

  const valid = new Set(offer.lines.map((line) => line.index));
  const chosen = lines
    .split(",")
    .map((text) => Number.parseInt(text, 10))
    .filter((index) => Number.isInteger(index) && valid.has(index));
  if (chosen.length === 0) return null;

  return {
    name: part.name,
    role: part.role,
    taken: part.taken,
    lineIndexes: [...new Set(chosen)].sort((a, b) => a - b),
    adjusted: adjusted === "1",
    agreement: part.agreement,
    readings: part.readings,
  };
}
