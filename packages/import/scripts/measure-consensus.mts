import { readFileSync } from "node:fs";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { inferComponents } from "../src/components.js";
import { consensusPartition } from "../../core/src/partitions.js";
import { COMPONENT_LABELS, scoreComponents } from "../../core/eval/fixtures/components.js";

/*
 * Three outcomes with distinct exit codes, because a measurement that cannot run must not look
 * like one that did. Both of these used to throw instead: `cascadeFromEnv()!` on a missing
 * provider, and an ENOENT stack on a corpus `/tmp` had cleared. A crash is the safe direction and
 * a poor diagnosis — three sibling scripts already name the command that fixes it, these did not.
 */
const cascade = cascadeFromEnv();
if (!cascade) {
  console.error("COULD NOT MEASURE: no inference cascade — check PASHKI_LLM_* in apps/web/.env.local");
  process.exit(3);
}
let recipes: Array<{ id: string; recipe_ingredients: Array<{ position: number; amount: number | null; unit: string | null; item_text: string }> }>;
try {
  recipes = JSON.parse(readFileSync("/tmp/clean.json", "utf8"));
} catch {
  console.error("COULD NOT MEASURE: /tmp/clean.json missing — run gen:corpus first.");
  process.exit(2);
}
const byId = new Map(recipes.map((r) => [r.id, r]));

const single = { right: 0, wrong: 0, declined: 0 };
const best = { right: 0, wrong: 0, declined: 0 };
let singleFound = 0, bestFound = 0, expected = 0, calls = 0;
const agreements: number[] = [];

for (const label of COMPONENT_LABELS) {
  const recipe = byId.get(label.id);
  if (!recipe) continue;
  const lines = recipe.recipe_ingredients.sort((a, b) => a.position - b.position)
    .map((i) => [i.amount ?? "", i.unit ?? "", i.item_text].join(" ").trim());

  const readings = [];
  for (let run = 0; run < 3; run += 1) {
    let r = null;
    try {
      r = await inferComponents({ provider: cascade.provider, model: cascade.models[0]!,
        recipe: { title: label.title, ingredients: lines } });
      calls += 1;
    } catch { calls += 1; }
    readings.push(r);
  }

  // the single-shot baseline is the FIRST reading — not the best of the three, which would be
  // the very cherry-pick this is measuring
  const one = scoreComponents(label.components, readings[0] ?? null);
  single[one.verdict] += 1;
  singleFound += one.matched;
  expected += one.countExpected;

  const agreed = consensusPartition(readings);
  const many = scoreComponents(label.components, agreed?.chosen ?? null);
  best[many.verdict] += 1;
  bestFound += many.matched;
  if (agreed) agreements.push(agreed.readings === 1 ? 0 : agreed.agreement);

  const mark = (v: string) => (v === "right" ? "  " : v === "declined" ? " ·" : " ✗");
  console.log(`${mark(one.verdict)}→${mark(many.verdict)} ${label.title.slice(0, 36).padEnd(37)} agree ${agreed ? (agreed.readings === 1 ? "0 (1 reading)" : agreed.agreement) : "-"}`);
}

const n = COMPONENT_LABELS.length;
const mean = agreements.length ? agreements.reduce((a, b) => a + b, 0) / agreements.length : 0;
console.log(`\nSINGLE SHOT      right ${single.right}/${n}  wrong ${single.wrong}  declined ${single.declined}  found ${singleFound}/${expected}`);
console.log(`BEST OF THREE    right ${best.right}/${n}  wrong ${best.wrong}  declined ${best.declined}  found ${bestFound}/${expected}`);
console.log(`\nmean agreement ${Math.round(mean * 100) / 100}   model calls ${calls} (${(calls / n).toFixed(1)} per recipe)`);
console.log(`recipes where the readings barely agreed (<0.6): ${agreements.filter((a) => a < 0.6).length}`);
