#!/usr/bin/env node
/**
 * Is a chapter icon reachable as an `<img>`, and does every icon a chapter names exist?
 *
 * ---------------------------------------------------------------------------
 * Why an `<img>` is the one mistake that would ship invisibly
 * ---------------------------------------------------------------------------
 *
 * The PNGs under `public/chapters/` are a designer's artwork whose **alpha channel carries the
 * ink** — the RGB under it is bark, measured at #27221C. Rendered as `<img>` that colour is baked
 * in and cannot answer a theme:
 *
 *   as <img>   #27221C on dark surface #28231E   1.01:1
 *   masked     --text  on dark surface #28231E  12.56:1
 *
 * Cook mode is always dark and /household has a dark theme, so an `<img>` here is an icon nobody
 * can see on half the app's surfaces. **No other guard catches it.** `check-contrast` reads the
 * stylesheet and a PNG's pixels are not in it; `check-harvest-classes` only asks whether the class
 * is styled, and it is. The page renders, the element is there, every check is green.
 *
 * ---------------------------------------------------------------------------
 * And the sibling failure, which the brief did not name
 * ---------------------------------------------------------------------------
 *
 * One failure, two consequences (§80): "the icon does not show" happens *either* because it was
 * drawn as an `<img>` in the dark, *or* because the file is not there at all — a mask pointing at
 * a 404 paints nothing, in both themes, with no console error a server render would surface. A
 * guard against only the first reads as coverage of the subject when it is coverage of one
 * assertion. So this also asserts that every `icon` named in `chapters.ts` is a file on disk.
 *
 * Three outcomes, distinct exit codes: a check that cannot run must not look like one that passed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ICONS = "apps/web/public/chapters";
const TREE = "apps/web/lib/chapters.ts";
const ROOTS = ["apps/web/app", "apps/web/components"];
const SKIP = new Set([".next", "node_modules"]);

for (const path of [ICONS, TREE]) {
  if (!existsSync(path)) {
    console.error(`COULD NOT MEASURE: ${path} is not there`);
    process.exit(2);
  }
}

const onDisk = new Set(readdirSync(ICONS).filter((name) => name.endsWith(".png")));
if (onDisk.size === 0) {
  console.error(`COULD NOT MEASURE: no .png under ${ICONS} — nothing to check`);
  process.exit(2);
}

const files = [];
for (const root of ROOTS) {
  if (!existsSync(root)) {
    console.error(`COULD NOT MEASURE: ${root} is not there`);
    process.exit(2);
  }
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(path)) files.push(path);
    }
  })(root);
}

const problems = [];

/*
 * Any `<img ...>` or `<Image ...>` element whose attributes mention the chapters directory.
 * Matched over the whole element rather than over `src=` alone, because the path usually arrives
 * through a variable or a template and `src={iconUrl(...)}` would slip a narrower pattern.
 */
let scanned = 0;
for (const path of files) {
  const source = readFileSync(path, "utf8");
  for (const [element] of source.matchAll(/<(?:img|Image)\b[^>]*>/gs)) {
    scanned++;
    if (/\/chapters\/|chapters\//.test(element)) {
      problems.push(
        `${path}: an <img>/<Image> references public/chapters.\n` +
          `      Masked, not drawn: a <span className="h-chapter-icon"> with\n` +
          `      style={{ ["--chapter-icon"]: iconUrl(name) }} and aria-hidden.\n` +
          `      Baked-in ink reads 1.01:1 on the dark surface.`,
      );
    }
  }
}

/* every icon the tree names must be a file — a mask onto a 404 paints nothing, silently */
const tree = readFileSync(TREE, "utf8");
const named = [...tree.matchAll(/icon:\s*"([^"]*\.png)"/g)].map(([, name]) => name);
if (named.length === 0) {
  console.error(`COULD NOT MEASURE: ${TREE} names no icons — the pattern has drifted`);
  process.exit(2);
}
for (const name of named) {
  if (!onDisk.has(name)) {
    problems.push(`${TREE}: names "${name}", which is not in ${ICONS}. A mask onto a missing file paints nothing.`);
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} chapter-icon violation(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

console.log(
  `${onDisk.size} chapter icons on disk; ${new Set(named).size} named by the tree and all present; ` +
    `${scanned} <img>/<Image> element(s) scanned, none reaching public/chapters.`,
);
