/**
 * §68's reversal condition, run: what fraction of this household's recipes have a nameable base?
 *
 * A component named `dressing` is a base somebody could make once. One named `protein` is the
 * model saying there is no separable part — which is the right answer for a grilled chicken. So
 * this is a population question, not a naming score, and §68 left it at 2 of 7: too few.
 *
 * Reads only. `inferComponents` three times per recipe and `consensusPartition` over the three,
 * exactly as the product does — but nothing is written, because a measurement must not change
 * the thing it measures.
 *
 * The sample is every sixth recipe by title from those not already split: deterministic, spans
 * the library, and not chosen by how promising it looked. One-pan dinners are included on
 * purpose — "what fraction have a base" has to count the ones that cannot.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../../apps/web/.env.local", import.meta.url), "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !line.startsWith("#")) process.env[line.slice(0, at).trim()] ??= line.slice(at + 1).trim();
}
const { cascadeFromEnv } = await import("../src/openai-compatible.js");
const { inferComponents } = await import("../src/components.js");
const { consensusPartition } = await import("../../core/src/partitions.js");

const cascade = cascadeFromEnv();
if (!cascade) { console.error("COULD NOT MEASURE: no inference cascade"); process.exit(3); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const get = async (p: string): Promise<any[]> => {
  const r = await fetch(`${url}/rest/v1/${p}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<any[]>;
};

const real = (await get("families?select=id,name&deleted_at=is.null")).find((f) => /lundall/i.test(f.name))!;
const recipes = (await get(
  `recipes?select=id,title,components&family_id=eq.${real.id}&deleted_at=is.null&derived_at=is.null&order=title`,
)).filter((r) => !Array.isArray(r.components));
const lines = await get(`recipe_ingredients?select=recipe_id,position,amount,unit,item_text,section&family_id=eq.${real.id}&deleted_at=is.null&order=position`);
const byRecipe = new Map<string, any[]>();
for (const l of lines) byRecipe.set(l.recipe_id, [...(byRecipe.get(l.recipe_id) ?? []), l]);

const sample = recipes.filter((_, i) => i % 6 === 0).slice(0, 10);
const ROLE_WORDS = new Set(["protein", "carbohydrate", "sauce", "vegetable", "garnish", "marinade", "sweet"]);

console.log(`\n${real.name}: ${recipes.length} unsplit recipes, sampling every 6th -> ${sample.length}\n`);
let withBase = 0, withOnlyRoles = 0, unmeasured = 0, calls = 0, stillRoleNamed = 0;

for (const recipe of sample) {
  const rows = byRecipe.get(recipe.id) ?? [];
  const text = rows.map((r) => [r.amount ?? "", r.unit ?? "", r.item_text ?? ""].join(" ").trim());
  const sections = rows.map((r) => r.section ?? null);
  if (text.length === 0) { unmeasured += 1; console.log(`  -- ${recipe.title.slice(0, 40)}  (no ingredients)`); continue; }

  const readings = await Promise.all(
    Array.from({ length: 3 }, async () => {
      calls += 1;
      try {
        return await inferComponents({
          provider: cascade.provider, model: cascade.models[0]!,
          recipe: { title: recipe.title, ingredients: text },
          ...(sections.some(Boolean) ? { sections } : {}),
        });
      } catch { return null; }
    }),
  );
  const agreed = consensusPartition(readings);
  if (!agreed) { unmeasured += 1; console.log(`  ?? ${recipe.title.slice(0, 40)}  (nothing came back — could not measure)`); continue; }

  const names = agreed.chosen.map((c) => (c.name ?? "").trim().toLowerCase()).filter(Boolean);
  /*
   * Two questions, and the first run of this script conflated them.
   *
   * "Is the name a role word" measures the PROMPT. Once the prompt asks for a name, every
   * single-component dish passes it — `loaded potato soup` is not a role word and is also not a
   * base. The POPULATION question is how many recipes have two or more parts at all, where one
   * of them is a part rather than the whole dish named once.
   */
  const roleNamed = names.filter((n) => ROLE_WORDS.has(n)).length;
  const hasParts = agreed.chosen.length > 1;
  if (hasParts) { withBase += 1; console.log(`  PARTS ${recipe.title.slice(0, 40).padEnd(40)} ${names.join(" · ")}`); }
  else { withOnlyRoles += 1; console.log(`  one   ${recipe.title.slice(0, 40).padEnd(40)} ${names.join(" · ") || "(unnamed)"}`); }
  if (roleNamed > 0) stillRoleNamed += 1;
}

const measured = withBase + withOnlyRoles;
console.log(`\n${calls} model calls, ${measured} recipes measured, ${unmeasured} could not be`);
console.log(`   POPULATION: two or more parts   ${withBase} of ${measured}${measured ? `  (${Math.round((withBase / measured) * 100)}%)` : ""}`);
console.log(`   one part, the whole dish        ${withOnlyRoles} of ${measured}`);
console.log(`   PROMPT: any part still role-named ${stillRoleNamed} of ${measured}`);
