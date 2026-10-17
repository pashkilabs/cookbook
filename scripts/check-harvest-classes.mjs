#!/usr/bin/env node
/**
 * Which `h-` classes does nothing style?
 *
 * The inverse question, the same one `check-tests-run` and `check-typechecked` ask. A class name
 * in JSX that no rule defines is **not an error anywhere**: it compiles, it renders, the element
 * is there, and it simply has no styling — which from outside is indistinguishable from a styling
 * decision. `pnpm check` is green, the page is wrong, and the only thing that would catch it is
 * somebody looking at that screen in that theme.
 *
 * It is the typo case mostly (`h-recipe-titel`), and the rename case, which is worse: a rule
 * renamed in `harvest.css` leaves every caller silently unstyled.
 *
 * Three outcomes, because a check that cannot run must not look like one that passed — if the
 * stylesheet or the app tree is missing, that is exit 2 and not a clean run over nothing.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const CSS = "apps/web/app/harvest.css";
const ROOTS = ["apps/web/app", "apps/web/components"];
const SKIP = new Set([".next", "node_modules"]);

if (!existsSync(CSS)) {
  console.error(`COULD NOT MEASURE: ${CSS} is not there`);
  process.exit(2);
}
const defined = new Set([...readFileSync(CSS, "utf8").matchAll(/\.(h-[a-z0-9-]+)/g)].map((m) => m[1]));
if (defined.size === 0) {
  console.error(`COULD NOT MEASURE: ${CSS} defines no h- classes at all`);
  process.exit(2);
}

const files = [];
for (const root of ROOTS) {
  if (!existsSync(root)) {
    console.error(`COULD NOT MEASURE: ${root} is not there — a renamed directory must not read as a pass`);
    process.exit(2);
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(path)) files.push(path);
    }
  };
  walk(root);
}

/*
 * Matched on the quoted literal rather than on `className=`, which covers the composed forms —
 * `["h-day", `is-${state}`]` and `clsx("h-chip", …)` — at the cost of also catching an `h-`
 * string used for something else. That direction is the safe one: a false positive is a name
 * somebody has to look at, and a false negative is the bug this exists to find.
 */
const used = new Map();
for (const file of files) {
  for (const match of readFileSync(file, "utf8").matchAll(/["'`](h-[a-z0-9-]+)["'`\s]/g)) {
    if (!used.has(match[1])) used.set(match[1], file);
  }
}

const orphans = [...used].filter(([name]) => !defined.has(name));
if (orphans.length > 0) {
  console.error(`${orphans.length} h- class(es) used in source that ${CSS} never styles:\n`);
  for (const [name, file] of orphans) console.error(`  .${name}  —  first used in ${file}`);
  console.error(`\nEither add the rule or fix the name. An unstyled element renders, so nothing else will tell you.`);
  process.exit(1);
}
console.log(`${used.size} h- classes used across ${files.length} files, every one of them styled.`);
