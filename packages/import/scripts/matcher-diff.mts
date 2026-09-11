/** What the stricter matcher changes on the recipes actually in production. */
import { readFileSync } from "node:fs";
import { createCatalog, normaliseName, lightName } from "../../core/src/index.js";
import { SEED_CATALOG } from "../../core/src/seed-catalog.js";

const catalog = createCatalog([...SEED_CATALOG]);

// the shipped-then-fixed behaviour, rebuilt here so both run on identical input
const raw = SEED_CATALOG.flatMap((item) => item.names.map((n) => ({ name: n.toLowerCase(), item })));
const claimed = new Set(raw.map((e) => e.name));
const derived = raw.map((e) => ({ name: normaliseName(e.name), item: e.item })).filter((e) => e.name && !claimed.has(e.name));
const byLength = [...raw, ...derived].sort((a, b) => b.name.length - a.name.length);
const oldFind = (name: string) => {
  const forms = [...new Set([normaliseName(name), lightName(name)])].filter(Boolean);
  for (const { name: candidate, item } of byLength) {
    for (const form of forms) if (form === candidate || form.includes(candidate)) return item;
  }
  return null;
};

const rows: Array<{ recipe_ingredients: Array<{ item_text: string | null }> }> =
  JSON.parse(readFileSync("/tmp/corpus.json", "utf8"));
const texts = [...new Set(rows.flatMap((r) => r.recipe_ingredients.map((i) => (i.item_text ?? "").trim())).filter(Boolean))];

let same = 0;
const lost: string[] = [];
const changed: string[] = [];
for (const text of texts) {
  const before = oldFind(text)?.key ?? null;
  const after = catalog.find(text)?.key ?? null;
  if (before === after) { same += 1; continue; }
  if (before !== null && after === null) lost.push(`${text}  (was ${before})`);
  else changed.push(`${text}  ${before} -> ${after}`);
}

console.log(`\n${texts.length} distinct ingredient lines in production\n`);
console.log(`  unchanged                 ${same}`);
console.log(`  no longer matched         ${lost.length}`);
console.log(`  matched something else    ${changed.length}\n`);
if (lost.length) { console.log("NO LONGER MATCHED — each is a match given up:"); for (const l of lost.slice(0, 40)) console.log(`   ${l}`); }
if (changed.length) { console.log("\nCHANGED:"); for (const c of changed.slice(0, 20)) console.log(`   ${c}`); }
