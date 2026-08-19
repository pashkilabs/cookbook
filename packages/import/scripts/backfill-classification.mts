import { createClient } from "@supabase/supabase-js";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { classifyRecipe, CLASSIFICATION_COLUMNS } from "../src/classify.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const cascade = cascadeFromEnv()!;
const dryRun = process.argv.includes("--dry-run");

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
const familyIds = [...new Set((scoped.data ?? []).map((row) => row.family_id as string))];

for (const family of familyIds.map((id) => ({ id, name: id.slice(0, 8) }))) {
  // the is-null predicate IS the cursor: re-running picks up only what is still unclassified
  const { data: recipes } = await admin
    .from("recipes")
    .select("id, title")
    .eq("family_id", family.id)
    .is("deleted_at", null)
    // the cursor is the *attempt*, not the answer: a marinade correctly classified as no course
    // stays null forever, and inferring "unfinished" from a null result re-ran it every time
    .is("classified_at", null)
    .order("title");
  if (!recipes?.length) { console.log(`${family.name}: nothing to classify`); continue; }
  console.log(`\n${family.name}: ${recipes.length} to classify`);

  for (const recipe of recipes) {
    // scoped to this recipe and this family — one recipe per prompt, never batched across households
    const [ings, steps] = await Promise.all([
      admin.from("recipe_ingredients").select("amount, unit, item_text, note, position").eq("recipe_id", recipe.id).is("deleted_at", null).order("position"),
      admin.from("recipe_steps").select("text, position").eq("recipe_id", recipe.id).is("deleted_at", null).order("position"),
    ]);
    const cls = await classifyRecipe({
      provider: cascade.provider, model: cascade.models[0]!,
      recipe: {
        title: recipe.title as string,
        // regression: this selected raw_text, which does not exist — PostgREST errored, `?? []`
        // swallowed it, and every recipe was classified from its title and steps with no
        // ingredients at all. A chicken traybake showing no protein was never a model failure.
        ingredients: (ings.data ?? []).map((i: any) =>
          [i.amount ?? "", i.unit ?? "", i.item_text, i.note ? `, ${i.note}` : ""].join(" ").trim()),
        steps: (steps.data ?? []).map((s: any) => s.text),
      },
    });
    if (!cls) { console.log(`  ${recipe.title}: model returned nothing, left unstamped to retry`); continue; }
    // stamped whatever the answer, so a correct null is finished work rather than a retry
    const patch = {
      course: cls.course,
      dish_form: cls.dishForm,
      principal_protein: cls.principalProtein,
      classified_at: new Date().toISOString(),
    };
    if (!dryRun) {
      const { error } = await admin.from("recipes").update(patch).eq("id", recipe.id);
      if (error) { console.log(`  ${recipe.title}: WRITE FAILED ${error.message}`); continue; }
    }
    console.log(`  ${String(recipe.title).slice(0,34).padEnd(35)} course=${String(patch.course).padEnd(9)} form=${String(patch.dish_form).padEnd(8)} protein=${patch.principal_protein}`);
  }
}
