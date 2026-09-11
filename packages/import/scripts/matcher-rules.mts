/** Three candidate rules, scored on the same production lines. Pick by data, not by argument. */
import { readFileSync } from "node:fs";
import { normaliseName, lightName } from "../../core/src/index.js";
import { SEED_CATALOG } from "../../core/src/seed-catalog.js";

const raw = SEED_CATALOG.flatMap((i) => i.names.map((n) => ({ name: n.toLowerCase(), item: i })));
const claimed = new Set(raw.map((e) => e.name));
const derived = raw.map((e) => ({ name: normaliseName(e.name), item: e.item })).filter((e) => e.name && !claimed.has(e.name));
const byLength = [...raw, ...derived].sort((a, b) => b.name.length - a.name.length);
const catalogWords = new Set(raw.flatMap((e) => e.name.split(/[\s-]+/)));

const PREP = new Set("fresh freshly chopped minced diced sliced grated shredded ground boneless skinless large small medium ripe cooked raw thinly roughly finely packed softened melted room temperature cold warm optional taste plus more divided serving garnish uncooked peeled trimmed rinsed drained halved quartered dried of or and for".split(" "));
const MEASURE = /^(c|tbsp|tsp|oz|lb|lbs|g|kg|ml|l|cup|cups|tablespoon|tablespoons|teaspoon|teaspoons|pint|pints|clove|cloves|bulb|bulbs|stalk|stalks|dollop|heaping|handful|pinch|can|cans|jar|jars|packet|bunch)\.?$/;
const isNum = (w: string) => /^[\d.,/¼½¾⅓⅔⅛-]+$/.test(w);
const harmless = (w: string) => PREP.has(w) || MEASURE.test(w) || isNum(w);

/** words naming a FORM or a distinct product, which change what you buy */
const FORM = new Set("powder granules extract essence ketchup vinegar syrup crumbs breadcrumbs zest flakes seeds sauce oil milk butter juice paste stock broth wine jam jelly".split(" "));

const words = (s: string) => s.split(/[\s-]+/).filter(Boolean);
const same = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;

function match(text: string, judge: (residue: string[], candidate: string, before: string[]) => boolean) {
  const forms = [...new Set([normaliseName(text), lightName(text)])].filter(Boolean);
  for (const { name: candidate, item } of byLength) {
    const wanted = words(candidate);
    for (const form of forms) {
      const w = words(form);
      for (let at = 0; at + wanted.length <= w.length; at += 1) {
        if (!wanted.every((x, n) => same(w[at + n]!, x))) continue;
        const residue = [...w.slice(0, at), ...w.slice(at + wanted.length)];
        if (judge(residue, candidate, w.slice(0, at))) return item;
      }
    }
  }
  return null;
}

const RULES = {
  "old (bare substring)": null,
  "A: residue all harmless": (r: string[]) => r.every(harmless),
  "B: no FORM word in residue": (r: string[]) => !r.some((x) => FORM.has(x)),
  "C: B, plus no residue word that is another catalog word": (r: string[]) =>
    !r.some((x) => FORM.has(x) || (!harmless(x) && catalogWords.has(x))),
  "E: D, but only a BARE head noun, and juice/zest are not forms": (r, candidate, before) => {
    const FORM_E = new Set([...FORM].filter((x) => x !== "juice" && x !== "zest"));
    if (r.some((x) => FORM_E.has(x))) return false;
    // only when the candidate IS the bare head noun: "coconut milk" is its own product, and
    // rejecting it because it contains "milk" was throwing away the specific match
    if (FORM_E.has(candidate) && before.some((x) => !harmless(x))) return false;
    return true;
  },
  "D: B, plus a FORM head noun admits no qualifier before it": (r, candidate, before) =>
    !r.some((x) => FORM.has(x)) &&
    !(words(candidate).some((x) => FORM.has(x)) && before.some((x) => !harmless(x))),
} as const;

const oldFind = (text: string) => {
  const forms = [...new Set([normaliseName(text), lightName(text)])].filter(Boolean);
  for (const { name: c, item } of byLength) for (const f of forms) if (f === c || f.includes(c)) return item;
  return null;
};

const rows: Array<{ recipe_ingredients: Array<{ item_text: string | null }> }> = JSON.parse(readFileSync("/tmp/corpus.json", "utf8"));
const texts = [...new Set(rows.flatMap((r) => r.recipe_ingredients.map((i) => (i.item_text ?? "").trim())).filter(Boolean))];

const BUGS: Array<[string, string]> = [
  ["almond milk", "milk"], ["soy milk", "milk"], ["onion powder", "onion"],
  ["garlic powder", "garlic"], ["garlic granules", "garlic"], ["whole-wheat flour", "flour"],
  ["tomato ketchup", "tomatoes"], ["rice vinegar", "rice"], ["avocado oil", "avocado"],
  ["bread crumbs", "bread"], ["buttermilk", "milk"],
];

console.log(`\n${texts.length} distinct production lines, ${BUGS.length} known conflations\n`);
const DETAIL = process.argv.includes("--detail");
for (const [name, judge] of Object.entries(RULES)) {
  if (!judge) continue;
  let lost = 0;
  for (const t of texts) {
    const before = oldFind(t)?.key ?? null;
    const after = match(t, judge)?.key ?? null;
    if (before !== null && after === null) lost += 1;
  }
  const fixed = BUGS.filter(([text, wrong]) => (match(text, judge)?.key ?? null) !== wrong).length;
  console.log(`  ${name.padEnd(52)} conflations fixed ${fixed}/${BUGS.length}   matches lost ${lost}/${texts.length}`);
  if (DETAIL && name.startsWith("E")) {
    console.log("\n    conflations NOT fixed:");
    for (const [text, wrong] of BUGS) {
      const got = match(text, judge)?.key ?? null;
      if (got === wrong) console.log(`      ${text} -> ${got}`);
    }
    console.log("\n    matches given up:");
    for (const t of texts) {
      const before = oldFind(t)?.key ?? null;
      if (before !== null && (match(t, judge)?.key ?? null) === null) console.log(`      ${t}  (was ${before})`);
    }
  }
}
