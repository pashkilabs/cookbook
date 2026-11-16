/**
 * Is this row's classification stable under the unchanged prompt?
 *
 * ---------------------------------------------------------------------------
 * Why this exists as a script rather than as a habit
 * ---------------------------------------------------------------------------
 *
 * §96: *"a prediction about one row is only a test when that row is stable under the unchanged
 * system."* Three runs of an identical prompt scored 6, 7 and 5 errors of 76 with every headline
 * figure identical and **a different six recipes each time** — so two of three pre-registered
 * predictions were disqualified before the change landed, because those rows reached their
 * predicted answer on their own.
 *
 * Stephen's own correction of that brief: *"which rows can carry evidence is itself a
 * pre-registration, and the control run is what establishes it. The control was the single most
 * useful thing in that round and I did not ask for it."* The missing half is the cheaper half, and
 * a cheap thing that has to be remembered is a thing that does not happen. This is that half, as a
 * command.
 *
 * It runs the **shipping path** — `classifyRecipe` with its consensus of three, the same call
 * `classifyIfUnclassified` and the backfill make — rather than a single reading, because a
 * measurement harness that does not reproduce production is how "14/30" got quoted as a baseline
 * when the figure was 20 (§61). What varies between runs here is what varies in production.
 *
 * Nothing is written. This reads and reports.
 *
 *   pnpm --filter @pashki/import stability:protein --family=<id> --match=shrimp --runs=3
 *
 * Exit codes: 0 every row stable, 1 at least one row moved, 2 could not measure.
 */
import { createClient } from "@supabase/supabase-js";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { classifyRecipe, classificationLines } from "../src/classify.js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cascade = cascadeFromEnv();
if (!url || !key) {
  console.error("COULD NOT MEASURE: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(2);
}
if (!cascade) {
  console.error("COULD NOT MEASURE: no inference cascade — check PASHKI_LLM_* in apps/web/.env.local");
  process.exit(2);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const family = process.argv.find((a) => a.startsWith("--family="))?.slice("--family=".length) ?? null;
const matches = process.argv.filter((a) => a.startsWith("--match=")).map((a) => a.slice("--match=".length).toLowerCase());
const runs = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice("--runs=".length) ?? 3);
if (!family) {
  console.error("COULD NOT MEASURE: --family=<id> is required. Households are named by the caller,");
  console.error("  because this script may not read platform tables to work them out (check-platform-tables).");
  process.exit(2);
}

const found = await admin
  .from("recipes")
  .select("id, title, principal_protein")
  .eq("family_id", family)
  .is("deleted_at", null)
  .order("title");
if (found.error) { console.error(`COULD NOT MEASURE: ${found.error.message}`); process.exit(2); }
const subjects = (found.data ?? []).filter(
  (r) => matches.length === 0 || matches.some((m) => String(r.title).toLowerCase().includes(m)),
);
if (subjects.length === 0) {
  console.error(`COULD NOT MEASURE: nothing in ${family.slice(0, 8)} matched ${JSON.stringify(matches)}.`);
  console.error("  A stability report over no rows is not a report that everything is stable.");
  process.exit(2);
}

console.log(`${subjects.length} recipe(s), ${runs} runs each, consensus of three readings per run\n`);
let moved = 0;
for (const recipe of subjects) {
  const [ings, steps] = await Promise.all([
    admin.from("recipe_ingredients").select("amount, unit, item_text, note").eq("recipe_id", recipe.id).is("deleted_at", null).order("position"),
    admin.from("recipe_steps").select("text").eq("recipe_id", recipe.id).is("deleted_at", null).order("position"),
  ]);
  const input = {
    title: recipe.title as string,
    ingredients: classificationLines(ings.data ?? []),
    steps: (steps.data ?? []).map((s) => s.text as string),
  };
  const answers: string[] = [];
  for (let run = 0; run < runs; run += 1) {
    const read = await classifyRecipe({ provider: cascade.provider, model: cascade.models[0]!, recipe: input });
    // a lost reading is not an answer — naming it keeps it out of the stability verdict
    answers.push(read ? `${read.classification.principalProtein ?? "null"}@${read.agreement.principalProtein}` : "LOST");
  }
  const labels = answers.map((a) => a.split("@")[0]!);
  const usable = labels.filter((l) => l !== "LOST");
  const stable = usable.length > 0 && new Set(usable).size === 1;
  if (!stable) moved += 1;
  console.log(
    `  ${stable ? "stable  " : "MOVED   "} stored=${String(recipe.principal_protein ?? "null").padEnd(11)}` +
      ` ${answers.join("  ")}   ${recipe.title}`,
  );
}
console.log(
  `\n${subjects.length - moved} of ${subjects.length} stable. A row that moved cannot carry evidence ` +
    `about a prompt change on its own.`,
);
process.exit(moved === 0 ? 0 : 1);
