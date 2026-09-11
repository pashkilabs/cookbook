/**
 * Score one fixture end to end: course, cuisine, steps and ingredients.
 *
 * `instagram-texas-twinkies` has never been scored on any of these. Its caption was damaged
 * from the day it was added, so extraction returned nothing and it dropped out of the run — and
 * the classification expectation in `caption-steps.ts` is consumed only by a unit test of the
 * *scoring functions*, never by anything that puts the caption through a model.
 *
 * Goes through the same `extractWithLlm` the product uses. Verifying an extractor through a
 * second harness is how the eval and the product came to disagree about which provider was even
 * being called, so there is one path here and it is the shipping one.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../../apps/web/.env.local", import.meta.url), "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !line.startsWith("#")) process.env[line.slice(0, at).trim()] ??= line.slice(at + 1).trim();
}

const { cascadeFromEnv } = await import("../src/openai-compatible.js");
const { extractWithLlm } = await import("../src/tier2.js");
const { caption_texas_twinkies } = await import("../../core/eval/fixtures/real.js");

const cascade = cascadeFromEnv();
if (!cascade) {
  console.error("COULD NOT MEASURE: no model configured");
  process.exit(3);
}

const text = (caption_texas_twinkies.input as { text: string }).text;
const expected = caption_texas_twinkies.expected.recipe!;

const result = await extractWithLlm({
  content: text,
  sourceUrl: "",
  sourceName: null,
  cascade,
});

const got = result.recipe;
if (!got) {
  console.error(`COULD NOT MEASURE: the extractor returned nothing (${result.attempts?.map((a) => a.outcome).join(", ") ?? "no attempts"})`);
  process.exit(3);
}

const line = (label: string, want: unknown, have: unknown) => {
  const ok = JSON.stringify(want) === JSON.stringify(have);
  console.log(`  ${ok ? "ok  " : "MISS"}  ${label.padEnd(14)} want ${JSON.stringify(want)}  got ${JSON.stringify(have)}`);
};

console.log("\ncaption-texas-twinkies — scored for the first time\n");
line("title", expected.title, got.title);
line("servings", expected.servings, got.servings);
line("totalMinutes", expected.totalMinutes, got.totalMinutes);
console.log(`\n  course   ${got.course ?? "(none)"}`);
console.log(`  cuisine  ${got.cuisine ?? "(none)"}`);
console.log(`  dishForm ${got.dishForm ?? "(none)"}   protein ${got.principalProtein ?? "(none)"}`);

console.log(`\n  STEPS (${got.steps.length}):`);
for (const [at, step] of got.steps.entries()) console.log(`    ${at + 1}. ${step}`);

console.log(`\n  INGREDIENTS (${got.ingredients.length} got, ${expected.ingredients.length} expected):`);
for (const ing of got.ingredients) {
  console.log(`    ${String(ing.amount ?? "—").padStart(5)} ${String(ing.unit ?? "").padEnd(6)} ${ing.item}`);
}
console.log("\n  expected:");
for (const ing of expected.ingredients) {
  console.log(`    ${String(ing.amount ?? "—").padStart(5)} ${String(ing.unit ?? "").padEnd(6)} ${ing.item}`);
}
