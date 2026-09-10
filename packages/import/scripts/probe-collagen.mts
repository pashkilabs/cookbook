import { readFileSync } from "node:fs";
import { collagenWarnings, collagenRichCut, longestSustainedMinutes } from "../../core/src/collagen.js";

type Row = {
  title: string;
  time_minutes: number | null;
  recipe_ingredients: Array<{ position: number; item_text: string | null; amount: number | null; unit: string | null }>;
  recipe_steps?: Array<{ position: number; text: string | null }>;
};
const rows: Row[] = JSON.parse(readFileSync("/tmp/corpus.json", "utf8"));

let fired = 0, carriesCut = 0, noDuration = 0;
for (const row of rows) {
  const ingredients = row.recipe_ingredients
    .sort((a, b) => a.position - b.position)
    .map((i) => [i.amount ?? "", i.unit ?? "", i.item_text ?? ""].join(" ").trim());
  const steps = (row.recipe_steps ?? []).sort((a, b) => a.position - b.position).map((s) => s.text ?? "");
  const cut = ingredients.map(collagenRichCut).find(Boolean) ?? null;
  if (cut) {
    carriesCut += 1;
    const longest = longestSustainedMinutes(steps);
    if (longest === null) noDuration += 1;
    console.log(`  cut=${cut.padEnd(14)} longest=${String(longest).padEnd(5)} stored=${String(row.time_minutes).padEnd(5)} ${row.title.slice(0, 40)}`);
  }
  const warnings = collagenWarnings({ ingredients, steps });
  if (warnings.length) {
    fired += 1;
    console.log(`  FIRES  ${row.title}\n         ${warnings[0]!.note}`);
  }
}
console.log(`\n${rows.length} recipes | ${carriesCut} carry a collagen-rich cut | ${noDuration} of those name no duration | FIRED ON ${fired}`);

// the control: a probe that cannot fire has measured nothing
const control = collagenWarnings({
  ingredients: ["500 g beef chuck, cubed"],
  steps: ["Stir-fry the beef for 6 minutes"],
});
console.log(`control (chuck into a 6-minute stir-fry): ${control.length === 1 ? "FIRES — the probe works" : "SILENT — the probe is broken, the zero above means nothing"}`);
