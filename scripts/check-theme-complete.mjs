/**
 * Does every colour a screen uses resolve in **dark** as well as light?
 *
 * Cook mode is always dark, so dark is a product surface here rather than a fallback — and a
 * browser is the only thing that can compute a cascade, which `curl` cannot. This is the honest
 * substitute: a **construction check** rather than a visual one. It asks two questions of the
 * generated stylesheet and the hand-written one:
 *
 *   1. does every colour declaration in `harvest.css` go through `var(--…)`, or is something
 *      hard-coded past `check-hex-literals` as a named colour like `white`?
 *   2. is every token those declarations reference redefined in **both** dark blocks — the
 *      media query and the explicit `[data-theme="dark"]` — so a toggle and cook mode both get it?
 *
 * A token defined only for light renders a cook-mode control in a light colour on espresso, and
 * that is invisible to every check except somebody looking at it.
 *
 * Three outcomes: a token missing from dark is 1, an unreadable stylesheet is 2, complete is 0.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

/* CSS named colours that would slip past a hex check */
const NAMED = /\b(?:background|color|border|border-color|outline|fill|stroke)\s*:\s*(white|black|red|blue|green|grey|gray|silver|orange|yellow|purple|pink)\b/g;

let hand, generated;
try {
  hand = readFileSync(path.join(root, "apps/web/app/harvest.css"), "utf8");
  generated = readFileSync(path.join(root, "apps/web/app/tokens.generated.css"), "utf8");
} catch (error) {
  console.error(`COULD NOT MEASURE: ${error.message}`);
  process.exit(2);
}

/** the text between a selector's own braces, so three adjacent blocks cannot read as one */
function ruleBody(css, selector) {
  const at = css.indexOf(selector);
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

const SITES = [
  ["system dark", "@media (prefers-color-scheme: dark)"],
  ['[data-theme="dark"]', ':root[data-theme="dark"]'],
  // the surface that is dark unconditionally, which makes this the one that cannot be a fallback
  ["cook mode (.h-cook)", ".h-cook"],
];

const darkSites = [];
for (const [label, selector] of SITES) {
  const body = ruleBody(generated, selector);
  if (body === null || body.length < 50) {
    console.error(`COULD NOT MEASURE: the generated stylesheet has no recognisable "${label}" block (${selector}).`);
    process.exit(2);
  }
  darkSites.push([label, body]);
}

const problems = [];

for (const [, colour] of hand.matchAll(NAMED)) {
  problems.push(`a named colour "${colour}" in harvest.css — use a token, it will not follow the theme`);
}

/*
 * Only the role tokens need a dark definition. The raw palette (`--colour-*`) and the scales
 * (`--space-*`, `--size-*`, `--radius-*`, `--type-*`) are theme-independent by design: a gram is a
 * gram in the dark.
 */
const referenced = new Set(
  [...hand.matchAll(/var\(--([a-z0-9-]+)/g)]
    .map(([, name]) => name)
    .filter((name) => !/^(colour|member|space|size|radius|type|font|shadow)-/.test(name)),
);

for (const token of [...referenced].sort()) {
  const declaration = new RegExp(`--${token}\\s*:`);
  for (const [label, body] of darkSites) {
    if (!declaration.test(body)) problems.push(`--${token} is not redefined for ${label}`);
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} theme problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `every one of the ${referenced.size} role tokens harvest.css uses resolves in all ${darkSites.length} dark sites: ` +
    darkSites.map(([label]) => label).join(", ") +
    ".",
);
