import { readFileSync } from "node:fs";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { inferComponents } from "../src/components.js";
import { COMPONENT_LABELS, scoreComponents } from "../../core/eval/fixtures/components.js";
import { consensusPartition } from "@pashki/core";

const cascade = cascadeFromEnv()!;
const recipes: Array<{ id: string; title: string; recipe_ingredients: Array<{ position: number; amount: number | null; unit: string | null; item_text: string }> }> =
  JSON.parse(readFileSync("/tmp/clean.json", "utf8"));
const byId = new Map(recipes.map((r) => [r.id, r]));
const withSections = process.argv.includes("--with-sections");
/*
 * Best-of-three by default, because that is what ships.
 *
 * This scored ONE reading while `componentsFor` stores the consensus of three. Two consequences,
 * both bad. The measurement path was not the shipping path — the divergence that let the eval
 * read a card perfectly while production sent an Anthropic model id to Together. And one reading
 * at n=30 is noisy enough to invent an effect: three runs of the *identical* prompt scored
 * right 14, 18 and 19 of thirty, a five-point spread, so any retune claiming less than that was
 * measuring the weather. `--single` keeps the old behaviour for comparison.
 */
const readingsPerRecipe = process.argv.includes("--single") ? 1 : 3;

const tally = { right: 0, wrong: 0, declined: 0 };
let unmeasured = 0;
const why = { empty: 0, malformed: 0 };
let matched = 0, expected = 0, rolesRight = 0, countRight = 0;
let saucesWanted = 0, saucesFound = 0;

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

  /*
   * The readings run in parallel, as they do in `componentsFor` — independent by construction,
   * so serialising only lengthens the wall clock. A provider failure is dropped as a non-vote
   * rather than counted as disagreement, which is also what production does.
   */
  const readings = await Promise.all(
    Array.from({ length: readingsPerRecipe }, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await inferComponents({
            provider: cascade.provider, model: cascade.models[0]!,
            recipe: { title: label.title, ingredients: lines },
            ...(sections ? { sections } : {}),
            onReject: (reason) => { why[reason] += 1; },
          });
        } catch {
          if (attempt === 2) return null;
        }
      }
      return null;
    }),
  );

  // every reading lost to the provider is a recipe nobody measured, not a cautious model
  if (readings.every((reading) => reading === null)) {
    unmeasured += 1;
    console.log(`  · ${label.title.slice(0, 40).padEnd(41)} COULD NOT MEASURE (provider)`);
    continue;
  }
  const agreed = readingsPerRecipe === 1 ? null : consensusPartition(readings);
  const proposed = readingsPerRecipe === 1
    ? readings[0] ?? null
    : (agreed?.chosen ?? null);
  const score = scoreComponents(label.components, proposed);
  tally[score.verdict] += 1;
  matched += score.matched; expected += score.countExpected; rolesRight += score.rolesRight;
  saucesWanted += score.saucesWanted; saucesFound += score.saucesFound;
  if (score.countProposed === score.countExpected) countRight += 1;
  const mark = score.verdict === "right" ? "  " : score.verdict === "declined" ? " ·" : " ✗";
  console.log(`${mark} ${label.title.slice(0, 40).padEnd(41)} want ${score.countExpected} got ${score.countProposed}  matched ${score.matched}/${score.countExpected}`);
}

const n = COMPONENT_LABELS.length;
console.log(`\n${withSections ? "WITH true sections" : "ingredients only"}, ${readingsPerRecipe} reading(s) per recipe${readingsPerRecipe > 1 ? " + consensus, as production does" : ""}`);
console.log(`  right ${tally.right}/${n}   wrong ${tally.wrong}   declined ${tally.declined}   could-not-measure ${unmeasured}`);
console.log(`  component count correct: ${countRight}/${n}`);
console.log(`  components found: ${matched}/${expected}   roles right: ${rolesRight}/${matched}`);
console.log(`  ROLE ACCURACY: ${rolesRight}/${matched} = ${matched?Math.round(rolesRight/matched*100):0}%`);
console.log(`  SAUCES RECOVERED: ${saucesFound}/${saucesWanted} = ${saucesWanted?Math.round(saucesFound/saucesWanted*100):0}%   <- the thing the retune is about`);
console.log(`  of the declines: ${why.empty} answered nothing, ${why.malformed} answered a non-partition`);
