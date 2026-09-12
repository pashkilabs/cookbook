import type { SupabaseClient } from "@supabase/supabase-js";
import { fingerprint, readTastes, tasteSummary, type RatingObservation, type TasteReading } from "@pashki/core";
import { rows } from "./rows";
import { platformClient } from "./platform";

/**
 * What the children of a household have said about the recipes they have eaten.
 *
 * **Through the seam for the people, directly for the ratings.** "Which members are children" is
 * a platform question and `family_members` is a platform table, so it goes through
 * `listMembers`; `ratings` and `recipes` are app tables and are queried here. That split is the
 * boundary, and it is the same shape the browse screen's kid-friendly filter uses.
 *
 * **Two answers to two different questions**, and never confused:
 *
 *   this file  what has *this child* said — counted, and useless when they have said little
 *   the model  what do children *generally* eat — useful exactly when the first is silent
 *
 * The second is not gated behind the first having enough data. A recipe nobody has tried is the
 * moment somebody is deciding whether to cook it, which is when general knowledge is worth most.
 * What matters is that a reader can tell them apart, so they are separate fields with separate
 * wording and are never merged into one sentence.
 */
export interface ChildTastes {
  memberId: string;
  displayName: string;
  birthYear: number | null;
  totalRatings: number;
  readings: TasteReading[];
  /** the sentence to show when nothing has enough behind it — never an empty render */
  summary: { state: "pattern" | "too-few" | "nothing"; message: string };
}

export async function childTastes(
  supabase: SupabaseClient,
  accountId: string,
  familyId: string,
): Promise<ChildTastes[]> {
  const members = await platformClient(accountId).listMembers();
  const children = members.filter((member) => member.isChild);
  if (children.length === 0) return [];

  const rated = rows(
    await supabase
      .from("ratings")
      .select("family_member_id, score, recipes(cuisine, principal_protein, dish_form, course)")
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .in(
        "family_member_id",
        children.map((child) => child.id),
      ),
    "child ratings",
  );

  return children.map((child) => {
    const mine = rated.filter((row) => row.family_member_id === child.id);
    const observations: RatingObservation[] = [];
    for (const row of mine) {
      const recipe = row.recipes as unknown as Record<string, string | null> | null;
      if (!recipe) continue;
      observations.push(
        { memberId: child.id, dimension: "cuisine", value: recipe.cuisine ?? null, score: row.score as number },
        { memberId: child.id, dimension: "principalProtein", value: recipe.principal_protein ?? null, score: row.score as number },
        { memberId: child.id, dimension: "dishForm", value: recipe.dish_form ?? null, score: row.score as number },
        { memberId: child.id, dimension: "course", value: recipe.course ?? null, score: row.score as number },
      );
    }
    const readings = readTastes(observations);
    return {
      memberId: child.id,
      displayName: child.displayName,
      birthYear: child.birthYear,
      totalRatings: mine.length,
      readings,
      summary: tasteSummary(readings, mine.length),
    };
  });
}

/**
 * What this household's children have said about *one* recipe's dimensions.
 *
 * Used for the warning before planning. Returns only readings that touch this recipe, so a
 * warning is about the dish in front of somebody rather than a general profile.
 */
export function warningsFor(
  tastes: readonly ChildTastes[],
  recipe: { cuisine: string | null; principal_protein: string | null; dish_form: string | null },
): Array<{ displayName: string; reading: TasteReading }> {
  /*
   * `course` is absent because it is not a telling dimension (`TELLING_DIMENSIONS` in core) —
   * almost every dinner is a main, so "Ada avoids main" says a child dislikes dinner. It used to
   * be absent by being left out of this list, which is the same behaviour reached by coincidence
   * rather than by decision, and the household screen was never told.
   */
  const wanted = new Map<string, string>([
    ["cuisine", recipe.cuisine ?? ""],
    ["principalProtein", recipe.principal_protein ?? ""],
    ["dishForm", recipe.dish_form ?? ""],
  ]);

  const out: Array<{ displayName: string; reading: TasteReading }> = [];
  for (const child of tastes) {
    for (const reading of child.readings) {
      if (wanted.get(reading.dimension) !== reading.value) continue;
      /*
       * Only `avoids`, and only a `pattern`.
       *
       * A warning is more forceful than a display, so it is held to the higher bar: an
       * observation may show from three ratings, but interrupting somebody's planning needs the
       * six. And "Ada likes this" is not a warning — surfacing it here would make the row noise
       * and teach people to dismiss it.
       */
      if (reading.state === "pattern" && reading.leaning === "avoids") {
        out.push({ displayName: child.displayName, reading });
      }
    }
  }
  return out;
}

/**
 * The general-knowledge note for a recipe — from the cache, or computed once and kept.
 *
 * **Why a column and not a memo.** This was a model call on every page view where nothing had
 * been rated: the only cost here that scales with *reading* rather than importing. A memo would
 * die with the serverless instance and miss on almost every view while appearing to work in
 * development, and `import_cache` is keyed by URL and shared across households — the wrong key
 * and the wrong scope for something per-recipe.
 *
 * **Invalidated by its only input.** `palate_key` fingerprints the ingredient lines the note was
 * computed from, so an edit recomputes and nothing else does. Derived from the input rather than
 * bumped by hand, because a stamp only works if something turns it — and nobody turned
 * EXTRACTOR_VERSION for two releases.
 *
 * Null-safe throughout: no cascade, no notes, and a cache write that fails is a warning rather
 * than a failed page. A recipe is readable whether or not a model is reachable.
 */
export async function palateNotesFor(
  supabase: SupabaseClient,
  recipe: { id: string; title: string | null; palate_notes?: unknown; palate_key?: string | null },
  ingredients: ReadonlyArray<{ item_text?: string | null; amount?: number | null; unit?: string | null }>,
): Promise<import("@pashki/import").PalateNote[]> {
  const lines = ingredients.map((row) =>
    [row.amount ?? "", row.unit ?? "", row.item_text ?? ""].join(" ").trim(),
  );
  const key = promptKey(recipe.title, lines);

  if (recipe.palate_key === key && Array.isArray(recipe.palate_notes)) {
    return recipe.palate_notes as import("@pashki/import").PalateNote[];
  }

  const { cascadeFromEnv, palateNotes } = await import("@pashki/import");
  const cascade = cascadeFromEnv();
  if (!cascade || !recipe.title) return [];

  let notes: import("@pashki/import").PalateNote[];
  try {
    notes = await palateNotes({
      provider: cascade.provider,
      model: cascade.models[0]!,
      recipe: { title: recipe.title, ingredients: lines },
      // no band: the note is about the dish, and a year of birth never leaves the platform (§58)
      band: null,
    });
  } catch {
    return [];
  }

  /*
   * An empty result is cached too.
   *
   * A plain roast chicken has nothing demanding about it, and that answer costs the same call as
   * any other. Treating empty as "not yet computed" would re-ask forever for exactly the recipes
   * the model has already considered and passed.
   */
  const { error } = await supabase
    .from("recipes")
    .update({ palate_notes: notes, palate_key: key })
    .eq("id", recipe.id);
  if (error) console.warn(`[pashki] palate notes not cached for ${recipe.id}: ${error.message}`);

  return notes;
}

/**
 * A stable fingerprint of the ingredient lines.
 *
 * Not cryptographic — this decides whether to spend a fraction of a cent, not whether to trust
 * anything. Order matters, because reordering ingredients is an edit and the cheap thing to do
 * with an edit is recompute.
 */
/**
 * The key for a cached model answer: every input the prompt carries, and nothing else.
 *
 * regression: this fingerprinted amount/unit/item_text alone, while the title went to both
 * prompts and the declared sections went to `inferComponents` — and sections are the single
 * strongest input there, worth `right` 14 → 25 of thirty. So typing "For the sauce:" into a
 * recipe left the key **byte-identical** and served the partition computed without it, forever.
 *
 * That is the EXTRACTOR_VERSION trap wearing an input-derived key: a stale answer that is
 * confident, well-formed, and indistinguishable from a fresh one. Deriving the key from the
 * input is what removes the human step — but only if it is derived from *all* of it. So the rule
 * is: an input reaches the model through this function, or it does not reach the model.
 *
 * Sections are joined with a separator that cannot occur in text, so a section named "x" on a
 * line "y" is not the same key as no section on "x\u0001y".
 */
export function promptKey(
  title: string | null,
  lines: readonly string[],
  sections?: ReadonlyArray<string | null>,
): string {
  // mirrors `hasSections` at the call site: sections are only *sent* when one of them exists, so
  // a recipe with none must key identically whether the caller passed an array of nulls or nothing
  const sent = sections?.some(Boolean) ? sections : undefined;
  return fingerprint([
    title ?? "",
    ...lines.map((line, at) => (sent ? `${sent[at] ?? ""}\u0001${line}` : line)),
  ]);
}

// `fingerprint` comes from core, so a blend's lineage key and a cache key are one function
// rather than two implementations that agree until somebody edits one of them


/**
 * Keep only the recipes a child rated 4 or 5, with none rating them lower.
 *
 * The practical rule rather than the strict one (§ the kid-friendly decision): "every child has
 * rated it" is blank for months and an empty chip reads as broken, where "somebody likes it and
 * nobody objects" is usable from the first few ratings.
 *
 * Computed rather than stored — it is a household's judgement, it differs per household, and a
 * column would go stale the moment a child changed their mind. Through the seam for the people,
 * directly for the ratings.
 */
export async function keepKidFriendly<T extends { recipe: { id: string } }>(
  supabase: SupabaseClient,
  accountId: string,
  familyId: string,
  hits: readonly T[],
): Promise<T[]> {
  if (hits.length === 0) return [];
  const members = await platformClient(accountId).listMembers();
  const childIds = members.filter((member) => member.isChild).map((member) => member.id);
  if (childIds.length === 0) return [];

  const rated = rows(
    await supabase
      .from("ratings")
      .select("recipe_id, score")
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .in("family_member_id", childIds)
      .in("recipe_id", hits.map((hit) => hit.recipe.id)),
    "kid-friendly ratings",
  );

  const liked = new Set<string>();
  const disliked = new Set<string>();
  for (const row of rated) {
    if ((row.score as number) >= 4) liked.add(row.recipe_id as string);
    else disliked.add(row.recipe_id as string);
  }
  return hits.filter((hit) => liked.has(hit.recipe.id) && !disliked.has(hit.recipe.id));
}

/**
 * The components of a recipe — from the cache, or read three times and agreed once.
 *
 * **Stored, not inferred live.** Inference scored 11, 12 and 19 of thirty on identical input, so
 * a household visiting the same recipe twice would see it split two different ways. That is
 * incoherent whatever the accuracy, and a blend built on a shifting partition would be a
 * different dish each time somebody looked.
 *
 * **Best-of-three at write is legitimate where best-of-three at read is not.** Three calls spent
 * once buy one stable answer; one call spent repeatedly buys a different answer every time. The
 * reading the other two most agree with is kept, along with how much they agreed — a low
 * agreement is not a wrong answer, it is a partition nobody should build on yet.
 *
 * Keyed on the ingredient lines, like the palate note, so an edit recomputes and nothing else
 * does. Storing also makes the number improvable: a stored partition can be recomputed when
 * detection improves, where a live one can only be re-rolled.
 */
export async function componentsFor(
  supabase: SupabaseClient,
  recipe: {
    id: string;
    title: string | null;
    components?: unknown;
    components_key?: string | null;
    components_agreement?: number | null;
    components_readings?: number | null;
  },
  ingredients: ReadonlyArray<{ item_text?: string | null; amount?: number | null; unit?: string | null; section?: string | null }>,
): Promise<{
  components: import("@pashki/import").RecipeComponent[];
  agreement: number;
  /** how many of the three runs returned a usable partition — two agreeing is not three */
  readings: number;
} | null> {
  const lines = ingredients.map((row) =>
    [row.amount ?? "", row.unit ?? "", row.item_text ?? ""].join(" ").trim(),
  );
  // a declared heading is the strongest evidence a recipe gives about its own components, and
  // took `right` from ~14 to 25 of thirty when supplied
  const sections = ingredients.map((row) => row.section ?? null);
  const hasSections = sections.some(Boolean);
  const key = promptKey(recipe.title, lines, sections);

  /*
   * A partition built on fewer than three readings is provisional, and is recomputed.
   *
   * Observed rather than theorised: Together returned 503 for two calls in three across a
   * multi-hour window, so best-of-three degrades to best-of-one exactly when the provider is
   * unwell — and the key then matches forever, freezing an outage's guess into the row
   * permanently. `git push` deploys and nothing reconsiders a cache.
   *
   * This costs nothing in the case that worries: a recipe the model *declines* three times
   * writes no row at all (`consensusPartition` returns null above the write), so it already
   * re-spends on every view and this does not make it worse. Only rows that stored something
   * on one or two readings are revisited — which is to say, only outages.
   */
  const settled = (recipe.components_readings ?? 0) >= 3;
  if (recipe.components_key === key && Array.isArray(recipe.components) && settled) {
    return {
      components: recipe.components as import("@pashki/import").RecipeComponent[],
      // a stored row with no agreement predates the column; 0 rather than 1, because unknown
      // confidence must not read as certainty
      agreement: typeof recipe.components_agreement === "number" ? recipe.components_agreement : 0,
      // a row written before the column existed reports 0 readings rather than a guess
      readings: typeof recipe.components_readings === "number" ? recipe.components_readings : 0,
    };
  }

  const { cascadeFromEnv, inferComponents } = await import("@pashki/import");
  const { consensusPartition } = await import("@pashki/core");
  const cascade = cascadeFromEnv();
  // captured before the guard: narrowing a property does not survive into a closure, and the
  // three readings below are closures now that they run together
  const title = recipe.title;
  if (!cascade || !title || lines.length === 0) return null;

  /*
   * The three readings run at once, not one after another.
   *
   * They are independent by construction — the whole point is three separate looks at the same
   * prompt — so waiting for one before starting the next only ever bought a longer wall clock.
   * At the twelve to thirty seconds a call has been taking, sequential is a minute and a half
   * and parallel is the slowest single call.
   *
   * That is not only a comfort. This runs inside a serverless function with a duration cap, and
   * three sixty-second timeouts in series is up to three minutes: the platform would kill the
   * request before the write, so the work was paid for and nothing was stored. Parallel puts
   * the worst case at one timeout.
   */
  const readings = await Promise.all(
    Array.from({ length: 3 }, async () => {
      try {
        return await inferComponents({
          provider: cascade.provider,
          model: cascade.models[0]!,
          recipe: { title, ingredients: lines },
          ...(hasSections ? { sections } : {}),
        });
      } catch {
        // a provider failure is not a reading — dropped rather than counted as disagreement
        return null;
      }
    }),
  );

  const agreed = consensusPartition(readings);
  if (!agreed) return null;

  /*
   * How many readings there were is stored, not just how much they agreed.
   *
   * A run lost to a provider error is dropped as a non-vote, so without this a recipe read
   * successfully twice stores the same 1.0 as one read three times — the fewer runs answered,
   * the more confident the row looks. That is the failure running in the unsafe direction, and
   * any later "do not blend below 0.6" rule would wave through exactly the rows built on the
   * least evidence.
   */
  const confidence = agreed.readings === 1 ? 0 : agreed.agreement;
  const { error } = await supabase
    .from("recipes")
    .update({
      components: agreed.chosen,
      components_key: key,
      components_agreement: confidence,
      components_readings: agreed.readings,
      components_agreed_on_count: agreed.agreedOnCount,
    })
    .eq("id", recipe.id);
  if (error) console.warn(`[pashki] components not cached for ${recipe.id}: ${error.message}`);

  // one surviving reading is not consensus, however internally consistent it looks
  return { components: agreed.chosen, agreement: confidence, readings: agreed.readings };
}
