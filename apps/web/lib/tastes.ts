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
