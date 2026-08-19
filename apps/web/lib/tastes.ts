import type { SupabaseClient } from "@supabase/supabase-js";
import { readTastes, tasteSummary, type RatingObservation, type TasteReading } from "@pashki/core";
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
  const key = fingerprint(lines);

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
function fingerprint(lines: readonly string[]): string {
  let hash = 5381;
  const joined = lines.join("\u0000").toLowerCase();
  for (let index = 0; index < joined.length; index += 1) {
    hash = ((hash * 33) ^ joined.charCodeAt(index)) >>> 0;
  }
  return `${lines.length}:${hash.toString(36)}`;
}
