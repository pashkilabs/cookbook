import { readFileSync } from "node:fs";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { inferComponents } from "../src/components.js";
import { COMPONENT_LABELS, scoreComponents } from "../../core/eval/fixtures/components.js";

const cascade = cascadeFromEnv()!;
const recipes: Array<{ id: string; title: string; recipe_ingredients: Array<{ position: number; amount: number | null; unit: string | null; item_text: string }> }> =
  JSON.parse(readFileSync("/tmp/clean.json", "utf8"));
const byId = new Map(recipes.map((r) => [r.id, r]));
const withSections = process.argv.includes("--with-sections");

const tally = { right: 0, wrong: 0, declined: 0 };
let unmeasured = 0;
const why = { empty: 0, malformed: 0 };
let matched = 0, expected = 0, rolesRight = 0, countRight = 0;

for (const label of COMPONENT_LABELS) {
  const recipe = byId.get(label.id);
  if (!recipe) { console.log(`  MISSING ${label.title}`); continue; }
  const lines = recipe.recipe_ingredients
    .sort((a, b) => a.position - b.position)
    .map((i) => [i.amount ?? "", i.unit ?? "", i.item_text].join(" ").trim());

  // the second condition: the TRUE section names, as if extraction had captured them perfectly.
  // an upper bound on what a section is worth, not a claim that any recipe has them.
  const sections = withSections
    ? lines.map((_, index) => label.components.find((c) => index >= c.from && index <= c.to)?.name ?? null)
    : null;

  // a timeout is the provider failing, not the model declining — retried before it is believed
  let proposed = null;
  let failed = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      proposed = await inferComponents({
        provider: cascade.provider, model: cascade.models[0]!,
        recipe: { title: label.title, ingredients: lines },
        ...(sections ? { sections } : {}),
        onReject: (reason) => { why[reason] += 1; },
      });
      break;
    } catch {
      if (attempt === 2) {
        // the provider failing is not the model declining — counted apart, or a bad connection
        // reads as a cautious model (CLAUDE.md: a check that could not run is not a result)
        unmeasured += 1;
        failed = true;
        console.log(`  · ${label.title.slice(0, 40).padEnd(41)} COULD NOT MEASURE (provider)`);
      }
    }
  }
  if (failed) continue;
  const score = scoreComponents(label.components, proposed);
  tally[score.verdict] += 1;
  matched += score.matched; expected += score.countExpected; rolesRight += score.rolesRight;
  if (score.countProposed === score.countExpected) countRight += 1;
  const mark = score.verdict === "right" ? "  " : score.verdict === "declined" ? " ·" : " ✗";
  console.log(`${mark} ${label.title.slice(0, 40).padEnd(41)} want ${score.countExpected} got ${score.countProposed}  matched ${score.matched}/${score.countExpected}`);
}

const n = COMPONENT_LABELS.length;
console.log(`\n${withSections ? "WITH true sections" : "ingredients only"}`);
console.log(`  right ${tally.right}/${n}   wrong ${tally.wrong}   declined ${tally.declined}   could-not-measure ${unmeasured}`);
console.log(`  component count correct: ${countRight}/${n}`);
console.log(`  components found: ${matched}/${expected}   roles right: ${rolesRight}/${matched}`);
console.log(`  ROLE ACCURACY: ${rolesRight}/${matched} = ${matched?Math.round(rolesRight/matched*100):0}%`);
console.log(`  of the declines: ${why.empty} answered nothing, ${why.malformed} answered a non-partition`);
