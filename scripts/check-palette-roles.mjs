#!/usr/bin/env node
/**
 * Is each token being used for the *job it names*?
 *
 * ---------------------------------------------------------------------------
 * Both directions, because the spec was silent on both
 * ---------------------------------------------------------------------------
 *
 * The palette table gives each role a hex and a one-line use, and says nothing about which side
 * of a declaration it belongs on. Two errors followed, mirror images of each other, and
 * `check-contrast` caught one of them only by accident of measuring the pair:
 *
 *   terracotta as TEXT    specified as "primary action (white text, 4.8:1)" — a figure about
 *                         white *on* terracotta. It clears AA on parchment alone.
 *   bark as a FILL        `background: var(--ink)` on `button, a.button`. `--ink` is the bridge
 *                         alias for `--text`, so every plain button in the app rendered
 *                         near-black — and `tokens.ts` contains no black at all.
 *
 * The second is the worse one, and not because it is uglier: a contrast check **cannot see it**.
 * Near-black behind white text has excellent contrast. It is legible, it passes, and it is simply
 * not this product's palette. So contrast is the wrong instrument and the right question is about
 * *role* — which this asks.
 *
 * ---------------------------------------------------------------------------
 * Three groups, and the middle one is why this does not cry wolf
 * ---------------------------------------------------------------------------
 *
 *   surface   a ground. Never a `color`.
 *   text      ink. Never a `background`.
 *   accent    legitimately both — terracotta fills a button and tints a link, olive fills a
 *             secondary and outlines one. Contrast decides those, not this, and
 *             `check-contrast` already gates every accent-as-text pair.
 *
 * Without that middle group this would flag every link in the app and be turned off within a
 * week. A check that fails routinely is one people learn to ignore.
 *
 * **Bridge aliases are resolved**, which is the whole reason this catches anything: the bug was
 * spelled `var(--ink)`, not `var(--text)`. A guard that only knew role names would have read the
 * offending rule and found nothing wrong with it.
 */
import { readFileSync, existsSync } from "node:fs";

const SHEETS = ["apps/web/app/globals.css", "apps/web/app/harvest.css"];
const GENERATED = "apps/web/app/tokens.generated.css";

const SURFACE = new Set(["bg", "surface", "surface-sunken", "chip-bg", "planned-bg"]);
const TEXT = new Set(["text", "text-body", "text-muted", "on-primary", "on-secondary", "on-highlight", "chip-text", "planned-text"]);
/* both sides are legitimate; `check-contrast` decides whether a given pair reads */
const ACCENT = new Set(["primary", "primary-pressed", "secondary", "highlight", "checked"]);
const EDGE = new Set(["border", "border-strong", "checkbox-edge"]);

for (const path of [...SHEETS, GENERATED]) {
  if (!existsSync(path)) {
    console.error(`COULD NOT MEASURE: ${path} is not there`);
    process.exit(2);
  }
}

/*
 * Every role the generated stylesheet actually defines, so a renamed token is a could-not-measure
 * rather than a quiet pass over a set this file has drifted away from.
 */
const generated = readFileSync(GENERATED, "utf8");
const root = generated.slice(generated.indexOf(":root"), generated.indexOf("@media"));
const defined = new Set([...root.matchAll(/--([a-z0-9-]+):/g)].map(([, name]) => name));
const known = [...SURFACE, ...TEXT, ...ACCENT, ...EDGE];
const missing = known.filter((role) => !defined.has(role));
if (missing.length > 0) {
  console.error(`COULD NOT MEASURE: this check names role(s) the tokens no longer define: ${missing.join(", ")}`);
  console.error("Update the groups in this file — a stale list reads as a pass.");
  process.exit(2);
}

/** `--ink: var(--text)` → ink resolves to text. One hop is all the bridge uses. */
function aliases(css) {
  const map = new Map();
  for (const [, from, to] of css.matchAll(/--([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)\s*;/g)) map.set(from, to);
  return map;
}

const problems = [];
for (const path of SHEETS) {
  const css = readFileSync(path, "utf8");
  const alias = aliases(css);
  const resolve = (name) => alias.get(name) ?? name;

  for (const rule of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    const selector = rule[1].trim().split("\n").pop().trim();
    // the alias block itself declares `--ink: var(--text)`, which is a definition not a painting
    if (selector.startsWith(":root") || selector.startsWith("@")) continue;

    /*
     * A fill under a mask is ink, not a ground.
     *
     * The chapter icons (§86) are PNGs whose alpha carries the drawing: `.h-chapter-icon` sets
     * `background-color: var(--text)` and masks it, so the box *becomes* the glyph and that fill
     * is the ink colour. Read as a ground it is exactly the bug this check was built for; read as
     * what it is, it is the only correct way to write it — an `<img>` would bake the ink in and
     * ship at 1.01:1 on the dark surface.
     *
     * Narrow on purpose: only a rule that itself declares a `mask` is exempt, so a plain
     * `background: var(--text)` anywhere else still fails. Widening a gate is how you find the
     * cases it was never asked about; widening it further than the case warrants is how a guard
     * stops meaning anything.
     */
    const masked = /(?:^|[\s;])(?:-webkit-)?mask\s*:/.test(rule[2]);

    for (const [, property, token] of rule[2].matchAll(
      /(?<![-a-z])(background(?:-color)?|color)\s*:\s*var\(--([a-z0-9-]+)\)/g,
    )) {
      const role = resolve(token);
      const spelled = role === token ? `--${token}` : `--${token} (which is --${role})`;
      if (property.startsWith("background") && TEXT.has(role) && !masked) {
        problems.push(
          `${path}: \`${selector}\` fills with ${spelled}, a TEXT role.\n` +
            `      A primary action is terracotta (--primary), a secondary is outlined olive,\n` +
            `      a chip is sage tint (--chip-bg), a planned chip is clay (--planned-bg).`,
        );
      }
      if (property === "color" && SURFACE.has(role)) {
        problems.push(`${path}: \`${selector}\` sets text to ${spelled}, a SURFACE role.`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} palette-role violation(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error("A contrast check cannot catch these: near-black behind white text reads perfectly");
  console.error("well and is simply not this product's palette.");
  process.exit(1);
}
console.log(`every background and colour in ${SHEETS.length} stylesheets uses a token for the job it names.`);
