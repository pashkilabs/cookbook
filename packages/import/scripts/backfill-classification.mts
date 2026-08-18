import { createClient } from "@supabase/supabase-js";
import { cascadeFromEnv } from "./src/openai-compatible.js";
import { classifyRecipe, CLASSIFICATION_COLUMNS } from "./src/classify.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const cascade = cascadeFromEnv()!;
const dryRun = process.argv.includes("--dry-run");

// §54: cuisine is excluded by measurement — it stops declining and starts guessing on stored shape
const WRITES = CLASSIFICATION_COLUMNS.filter((c) => c !== "cuisine");
console.log(`writes: ${WRITES.join(", ")}${dryRun ? "  (DRY RUN)" : ""}`);

const families = await admin.from("families").select("id, name").is("deleted_at", null);
for (const family of families.data ?? []) {
  // the is-null predicate IS the cursor: re-running picks up only what is still unclassified
  const { data: recipes } = await admin
    .from("recipes")
    .select("id, title")
    .eq("family_id", family.id)
    .is("deleted_at", null)
    .is("course", null)
    .order("title");
  if (!recipes?.length) { console.log(`${family.name}: nothing to classify`); continue; }
  console.log(`\n${family.name}: ${recipes.length} to classify`);

  for (const recipe of recipes) {
    // scoped to this recipe and this family — one recipe per prompt, never batched across households
    const [ings, steps] = await Promise.all([
      admin.from("recipe_ingredients").select("raw_text, position").eq("recipe_id", recipe.id).is("deleted_at", null).order("position"),
      admin.from("recipe_steps").select("text, position").eq("recipe_id", recipe.id).is("deleted_at", null).order("position"),
    ]);
    const cls = await classifyRecipe({
      provider: cascade.provider, model: cascade.models[0]!,
      recipe: {
        title: recipe.title as string,
        ingredients: (ings.data ?? []).map((i: any) => i.raw_text ?? ""),
        steps: (steps.data ?? []).map((s: any) => s.text),
      },
    });
    if (!cls) { console.log(`  ${recipe.title}: model returned nothing, left alone`); continue; }
    const patch = { course: cls.course, dish_form: cls.dishForm, principal_protein: cls.principalProtein };
    if (!dryRun) {
      const { error } = await admin.from("recipes").update(patch).eq("id", recipe.id);
      if (error) { console.log(`  ${recipe.title}: WRITE FAILED ${error.message}`); continue; }
    }
    console.log(`  ${String(recipe.title).slice(0,34).padEnd(35)} course=${String(patch.course).padEnd(9)} form=${String(patch.dish_form).padEnd(8)} protein=${patch.principal_protein}`);
  }
}
