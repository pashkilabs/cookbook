import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { classifyRecipe, classificationLines } from "../src/classify.js";
import { CLASSIFY_PROMPT_FINGERPRINT } from "../src/prompt-version.js";

/**
 * Score the classifier against a hand adjudication, writing nothing.
 *
 * ---------------------------------------------------------------------------
 * Why a harness and not the backfill
 * ---------------------------------------------------------------------------
 *
 * The backfill is how a classification *ships*, and it is governed by a provenance cursor: a row
 * whose `classified_with` equals today's prompt-and-model is settled and will not be asked again.
 * That is right for shipping and useless for measuring, because the one thing a measurement needs
 * is to ask the same question twice.
 *
 * So this reads the same rows through the same builder and the same `classifyRecipe`, and stores
 * nothing. It can therefore be run against an **unchanged** prompt to find out how much moves
 * when nothing has changed — which is the error bar, and the only thing that makes a two-recipe
 * improvement distinguishable from the weather. `measure-components` learned that the hard way:
 * three runs of an identical prompt scored 14, 18 and 19 of thirty, so every retune claiming less
 * than a five-point move had been measuring noise.
 *
 * ---------------------------------------------------------------------------
 * Null-rate is not accuracy
 * ---------------------------------------------------------------------------
 *
 * The first reading of this signal counted *answers*: nulls fell from 16 to 2 and that was
 * reported as the fix working. It was not — the fix had taught the model to answer, and said
 * nothing about whether the answers were right. Every number below is scored against a value a
 * person wrote down, and the errors are printed with their direction, because "all ten are false
 * positives" is what named the cause.
 */
const arg = (name: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;

const truthPath = arg("truth");
const outPath = arg("out");
const label = arg("label") ?? "unlabelled";
const runs = Number(arg("runs") ?? "1");
if (!truthPath) {
  console.log("usage: measure-classification --truth=<adjudication.json> [--out=<result.json>] [--label=<name>] [--runs=N]");
  process.exit(2);
}

interface Adjudicated {
  id: string;
  title: string;
  truth: string | null;
}
const adjudication = JSON.parse(readFileSync(truthPath, "utf8")) as {
  family: string;
  recipes: Adjudicated[];
};
const truth = new Map(adjudication.recipes.map((r) => [r.id, r]));

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const cascade = cascadeFromEnv();
if (!cascade) { console.log("COULD NOT MEASURE: no inference provider configured"); process.exit(2); }

/*
 * `.range(0, 999)` rather than a bare select.
 *
 * PostgREST caps an unbounded read at 1000 rows and says nothing about it. The first survey of
 * this library reported 54 recipes when there are 76, because an unscoped scan hit that cap — and
 * a round number at the limit is the only tell. Scoped to one household this cannot reach the
 * cap, and the range is here so the next reader does not have to work that out.
 */
const { data: recipes, error } = await admin
  .from("recipes")
  .select("id, title, principal_protein")
  .eq("family_id", adjudication.family)
  .is("deleted_at", null)
  .order("title")
  .range(0, 999);
if (error) { console.log(`COULD NOT MEASURE: ${error.message}`); process.exit(2); }

/*
 * A probe that could not have succeeded has measured nothing.
 *
 * If the adjudication does not cover what was loaded, every unmatched recipe scores as a miss and
 * the run reports a plausible, wrong number. This is exit 2 rather than a low score, because
 * "could not measure" and "measured badly" must not look alike.
 */
const uncovered = (recipes ?? []).filter((r) => !truth.has(r.id as string));
if (uncovered.length || !recipes?.length) {
  console.log(`COULD NOT MEASURE: ${recipes?.length ?? 0} recipes loaded, ${uncovered.length} with no adjudication`);
  for (const r of uncovered.slice(0, 5)) console.log(`  unadjudicated: ${r.title}`);
  process.exit(2);
}

console.log(`${label}: ${recipes.length} recipes, prompt ${CLASSIFY_PROMPT_FINGERPRINT}, model ${cascade.models[0]!.model}`);
console.log(`${runs} run${runs === 1 ? "" : "s"}, writing nothing to the database\n`);

interface Scored {
  id: string;
  title: string;
  truth: string | null;
  got: string | null;
  stored: string | null;
  agreement: number;
}

const allRuns: Scored[][] = [];
for (let run = 0; run < runs; run += 1) {
  const scored: Scored[] = [];
  for (const recipe of recipes) {
    const [ings, steps] = await Promise.all([
      admin.from("recipe_ingredients").select("amount, unit, item_text, note").eq("recipe_id", recipe.id as string).is("deleted_at", null).order("position"),
      admin.from("recipe_steps").select("text").eq("recipe_id", recipe.id as string).is("deleted_at", null).order("position"),
    ]);
    const read = await classifyRecipe({
      provider: cascade.provider,
      model: cascade.models[0]!,
      recipe: {
        title: recipe.title as string,
        ingredients: classificationLines(ings.data ?? []),
        steps: (steps.data ?? []).map((s) => s.text as string),
      },
    });
    scored.push({
      id: recipe.id as string,
      title: recipe.title as string,
      truth: truth.get(recipe.id as string)!.truth,
      // a run in which every reading failed is not an answer of null: it is recorded as a
      // non-measurement so it cannot be scored as a correct decline
      got: read ? read.classification.principalProtein : "READINGS FAILED",
      stored: (recipe.principal_protein as string | null) ?? null,
      agreement: read ? read.agreement.principalProtein : 0,
    });
    process.stdout.write(".");
  }
  console.log("");
  allRuns.push(scored);
}

const report = (scored: Scored[], heading: string) => {
  const failed = scored.filter((s) => s.got === "READINGS FAILED");
  const live = scored.filter((s) => s.got !== "READINGS FAILED");
  const right = live.filter((s) => s.got === s.truth);
  const named = live.filter((s) => s.got !== null);
  const namedRight = named.filter((s) => s.got === s.truth);
  const hasNone = live.filter((s) => s.truth === null);
  const declined = live.filter((s) => s.got === null);

  console.log(`\n=== ${heading} ===`);
  if (failed.length) console.log(`${failed.length} recipes NOT MEASURED — every reading failed`);
  const labels = [...new Set(live.map((s) => s.got))].sort((a, b) =>
    live.filter((s) => s.got === b).length - live.filter((s) => s.got === a).length);
  console.log("label        n  right  precision");
  for (const value of labels) {
    const rows = live.filter((s) => s.got === value);
    const ok = rows.filter((s) => s.got === s.truth).length;
    console.log(`  ${String(value ?? "(null)").padEnd(11)} ${String(rows.length).padStart(2)}  ${String(ok).padStart(5)}  ${Math.round((100 * ok) / rows.length)}%`);
  }
  console.log(`named a protein: ${namedRight.length}/${named.length} = ${Math.round((100 * namedRight.length) / named.length)}% precision`);
  console.log(`declined:        ${declined.filter((s) => s.truth === null).length}/${declined.length} correct, and ${declined.filter((s) => s.truth === null).length}/${hasNone.length} of the recipes that have none = ${Math.round((100 * declined.filter((s) => s.truth === null).length) / hasNone.length)}% recall`);
  console.log(`whole library:   ${right.length}/${live.length} = ${Math.round((100 * right.length) / live.length)}%`);

  const wrong = live.filter((s) => s.got !== s.truth);
  console.log(`errors (${wrong.length}):`);
  for (const s of wrong) console.log(`  ${String(s.got ?? "(null)").padEnd(11)} ${s.title} → should be ${s.truth ?? "null"}`);
  return { right: right.length, live: live.length, wrong: wrong.length };
};

for (const [index, scored] of allRuns.entries()) {
  report(scored, runs === 1 ? label : `${label}, run ${index + 1} of ${runs}`);
}

/*
 * Movement against the stored labels — the error bar, when the prompt has not changed.
 *
 * A recipe whose answer differs from what is stored, under an identical prompt, moved for no
 * reason but sampling. Printed rather than summarised, because which ones move is the useful
 * part: a soft row moving is weather, and a row that has been stable moving is a finding.
 */
const first = allRuns[0]!;
const moved = first.filter((s) => s.got !== s.stored && s.got !== "READINGS FAILED");
console.log(`\n=== movement against the stored labels (${moved.length} of ${first.length}) ===`);
for (const s of moved) {
  const verdict = s.got === s.truth ? "now right" : s.stored === s.truth ? "WAS RIGHT, now wrong" : "wrong either way";
  console.log(`  ${String(s.stored ?? "(null)").padEnd(9)} -> ${String(s.got ?? "(null)").padEnd(9)} ${verdict.padEnd(21)} ${s.title}`);
}

if (runs > 1) {
  const unstable = first.filter((_, i) => allRuns.some((r) => r[i]!.got !== first[i]!.got));
  console.log(`\n=== unstable across ${runs} runs of the same prompt: ${unstable.length} of ${first.length} ===`);
  for (const s of unstable) {
    console.log(`  ${s.title}: ${allRuns.map((r) => String(r.find((x) => x.id === s.id)!.got ?? "null")).join(" / ")}`);
  }
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify({ label, prompt: CLASSIFY_PROMPT_FINGERPRINT, model: cascade.models[0]!.model, runs: allRuns }, null, 2));
  console.log(`\nwrote ${outPath}`);
}
