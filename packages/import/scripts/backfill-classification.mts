import { createClient } from "@supabase/supabase-js";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { classifyRecipe, classificationLines, CLASSIFICATION_COLUMNS } from "../src/classify.js";
import { classificationProvenance } from "../src/prompt-version.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const cascade = cascadeFromEnv()!;
const dryRun = process.argv.includes("--dry-run");
/*
 * `--family=<id>` scopes a run to one household.
 *
 * Added because the provenance cursor widened what counts as "needs work": every row is eligible
 * until it records what classified it, so an unscoped run now asks a model about **every recipe in
 * every household** — and this project's database carries about fifty test households from smoke
 * and the renderer, roughly 950 recipes nobody wants classified. A backfill that costs an
 * inference call per row needs a way to say which rows.
 */
const onlyFamily = process.argv.find((a) => a.startsWith("--family="))?.split("=")[1] ?? null;

// §54: cuisine is excluded by measurement — it stops declining and starts guessing on stored shape
const WRITES = CLASSIFICATION_COLUMNS.filter((c) => c !== "cuisine");
console.log(`writes: ${WRITES.join(", ")}${dryRun ? "  (DRY RUN)" : ""}`);

/*
 * Households derived from the recipes themselves, not from `families`.
 *
 * The seam applies to scripts. A maintenance script holding the service role is *more* reason
 * to keep it out of platform tables, not less — service_role bypasses RLS, so a script is the
 * one caller for which nothing else would stop it, and "it is only a script" is how a boundary
 * becomes advisory. Extracting a platform for app #2 has to be mechanical, and a script that
 * reads `families` is one more place to find and rewrite.
 *
 * It also turned out not to need them: the question is "which households have unclassified
 * recipes", and `recipes` answers that. Grouping by family_id keeps the per-household scoping
 * this needs — one household's recipes never reach another's prompt — without asking the
 * platform anything.
 */
const scoped = await admin
  .from("recipes")
  .select("family_id")
  .is("deleted_at", null)
  .is("classified_at", null);
if (scoped.error) throw scoped.error;
const familyIds = onlyFamily
  ? [onlyFamily]
  : [...new Set((scoped.data ?? []).map((row) => row.family_id as string))];
if (onlyFamily) console.log(`scoped to one household: ${onlyFamily}`);

for (const family of familyIds.map((id) => ({ id, name: id.slice(0, 8) }))) {
  // the is-null predicate IS the cursor: re-running picks up only what is still unclassified
  const { data: recipes } = await admin
    .from("recipes")
    .select("id, title, classified_at, classified_with")
    .eq("family_id", family.id)
    .is("deleted_at", null)
    /*
     * The cursor was `.is("classified_at", null)` — the *attempt*, which was right about one
     * failure and wrong about another. It correctly stopped re-asking about a marinade that
     * genuinely has no course. It also meant a row asked once with a different model and come
     * back empty was **never asked again**: 49 of 76 recipes in the real library sat stamped with
     * a null protein that re-running names correctly for about 70% of them.
     *
     * So the cursor is now the attempt AND what it was made with. Filtered below rather than in
     * the query, because "is null or differs from this string" is clearer read in one place than
     * as a PostgREST `or(...)`.
     */
    .order("title");
  const current = classificationProvenance(cascade.models[0]!.model);
  const todo = (recipes ?? []).filter(
    (r: any) => !r.classified_at || r.classified_with !== current,
  );
  if (!todo.length) { console.log(`${family.name}: nothing to classify`); continue; }
  console.log(
    `\n${family.name}: ${todo.length} of ${recipes!.length} to classify ` +
      `(${(recipes ?? []).filter((r: any) => r.classified_at && r.classified_with !== current).length} ` +
      `stamped by something else)`,
  );

  for (const recipe of todo) {
    // scoped to this recipe and this family — one recipe per prompt, never batched across households
    const [ings, steps] = await Promise.all([
      admin.from("recipe_ingredients").select("amount, unit, item_text, note, position").eq("recipe_id", recipe.id).is("deleted_at", null).order("position"),
      admin.from("recipe_steps").select("text, position").eq("recipe_id", recipe.id).is("deleted_at", null).order("position"),
    ]);
    const read = await classifyRecipe({
      provider: cascade.provider, model: cascade.models[0]!,
      recipe: {
        title: recipe.title as string,
        // regression: this selected raw_text, which does not exist — PostgREST errored, `?? []`
        // swallowed it, and every recipe was classified from its title and steps with no
        // ingredients at all. A chicken traybake showing no protein was never a model failure.
        ingredients: classificationLines(ings.data ?? []),
        steps: (steps.data ?? []).map((s: any) => s.text),
      },
    });
    if (!read) { console.log(`  ${recipe.title}: every reading failed, left unstamped to retry`); continue; }
    // stamped whatever the answer, so a correct null is finished work rather than a retry
    const patch = {
      course: read.classification.course,
      dish_form: read.classification.dishForm,
      principal_protein: read.classification.principalProtein,
      classified_at: new Date().toISOString(),
      classified_with: current,
      // how firm the answer is, stored beside it: never gated on, and the only thing that tells
      // a reader which rows are a coin-flip (§61)
      classified_agreement: read.agreement,
      classified_readings: read.readings,
    };
    if (!dryRun) {
      const { error } = await admin.from("recipes").update(patch).eq("id", recipe.id);
      if (error) { console.log(`  ${recipe.title}: WRITE FAILED ${error.message}`); continue; }
    }
    console.log(
      `  ${String(recipe.title).slice(0,34).padEnd(35)} course=${String(patch.course).padEnd(9)} ` +
        `form=${String(patch.dish_form).padEnd(8)} protein=${String(patch.principal_protein).padEnd(11)} ` +
        `${read.readings} readings, protein agreed ${read.agreement.principalProtein}`,
    );
  }
}
