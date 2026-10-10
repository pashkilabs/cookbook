/**
 * Which of this household's recipes name something it avoids (§71).
 *
 * ---------------------------------------------------------------------------
 * One implementation, because a recipe hidden in one place and offered in another is worse
 * than consistent silence
 * ---------------------------------------------------------------------------
 *
 * Several screens read recipes — the list, search, the planner's waiting list, the shortlist, the
 * blend picker, the alongside footnote — and each one is a place a recipe could be offered. A
 * filter wired into some of them teaches a household that the setting works, which is the
 * dangerous half of getting it wrong: they would stop reading labels on the strength of a
 * protection that only covers the screen they happened to test.
 *
 * So the verdicts are computed once, here, from `readAllergens` in core. The matcher is pure and
 * measured; this is only the join that was missing — **the setting saved, the matcher worked, and
 * nothing connected them**, which is how a filter that silently did nothing about an allergy
 * reached production.
 *
 * ---------------------------------------------------------------------------
 * Hide, flag, or show
 * ---------------------------------------------------------------------------
 *
 *   excluded  a term matched a written ingredient. **Removed** from anywhere recipes are
 *             offered, and the count stated so the absence is visible rather than silent.
 *   unknown   something bought ready-made could plausibly carry it. **Shown with the product
 *             named**, because this is the case a person has to resolve by reading a label and
 *             hiding it would teach them the app had done that for them.
 *   clear     shown. Not "safe" — nothing here ever says safe.
 *
 * Opening a recipe **directly** never refuses: somebody with the link asked for that recipe, and
 * a 404 for a recipe that exists is a worse answer than the recipe plus the reason.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLERGENS, readAllergens, type Allergen, type AllergenVerdict } from "@pashki/core";
import { rows } from "./rows";

export interface AllergenNote {
  allergen: Allergen;
  verdict: AllergenVerdict;
  /** the written line that decided it, quoted so a person can check rather than trust */
  because: string;
  /** set when the verdict is `unknown`: the bought product that could carry it */
  product?: string;
}

export interface AllergenReadings {
  /** recipe id → the notes for it, worst first. Absent means clear for everything avoided. */
  byRecipe: Map<string, AllergenNote[]>;
  /** recipe ids to remove from anywhere recipes are offered */
  excluded: Set<string>;
  /** what the household avoids, so a caller can say nothing rather than say nothing is wrong */
  avoided: Allergen[];
}

const EMPTY: AllergenReadings = { byRecipe: new Map(), excluded: new Set(), avoided: [] };

/**
 * Read every avoided allergen against every recipe in one query.
 *
 * One query for all the lines rather than one per recipe — the shape `alongsideThisWeek` and the
 * shopping list already use, and the reason this is affordable on a list screen.
 *
 * Scoped by `family_id` explicitly: RLS decides what may leave the database and a screen decides
 * whose kitchen it shows, and a published recipe from another household would otherwise bring its
 * ingredient rows along.
 */
export async function readAvoidedAllergens(
  supabase: SupabaseClient,
  familyId: string,
  avoidedAllergens: readonly string[],
): Promise<AllergenReadings> {
  const avoided = avoidedAllergens.filter((value): value is Allergen =>
    (ALLERGENS as readonly string[]).includes(value),
  );
  if (avoided.length === 0) return EMPTY;

  const lines = rows(
    await supabase
      .from("recipe_ingredients")
      .select("recipe_id, item_text, amount, unit")
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .order("position"),
    "ingredient lines for the allergen filter",
  );

  const byId = new Map<string, string[]>();
  for (const line of lines) {
    const id = line.recipe_id as string;
    const written = [line.amount ?? "", line.unit ?? "", line.item_text ?? ""].join(" ").trim();
    if (!written) continue;
    const list = byId.get(id);
    if (list) list.push(written);
    else byId.set(id, [written]);
  }

  const byRecipe = new Map<string, AllergenNote[]>();
  const excluded = new Set<string>();
  for (const [id, written] of byId) {
    const notes: AllergenNote[] = [];
    for (const [allergen, reading] of readAllergens(written, avoided)) {
      if (reading.verdict === "excluded") {
        excluded.add(id);
        notes.push({ allergen, verdict: "excluded", because: reading.matched[0] ?? "" });
      } else if (reading.verdict === "unknown" && reading.opaque[0]) {
        notes.push({
          allergen,
          verdict: "unknown",
          because: reading.opaque[0].line,
          product: reading.opaque[0].product,
        });
      }
    }
    // excluded first: a definite match is the one somebody has to see
    if (notes.length > 0) {
      byRecipe.set(id, notes.sort((a, b) => (a.verdict === "excluded" ? -1 : b.verdict === "excluded" ? 1 : 0)));
    }
  }

  return { byRecipe, excluded, avoided };
}

/** the sentence for a note — "can contain", never "may be unsafe", and never "safe" */
export function allergenSentence(note: AllergenNote): string {
  const name = note.allergen === "tree-nut" ? "tree nuts" : note.allergen;
  return note.verdict === "excluded"
    ? `Contains ${name}: “${note.because}”.`
    : `Contains ${note.product}, which can contain ${name} — worth checking the label.`;
}
