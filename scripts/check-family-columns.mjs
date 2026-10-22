#!/usr/bin/env node
/**
 * Does every select against `families` go through `FAMILY_COLUMNS`?
 *
 * ---------------------------------------------------------------------------
 * The failure this exists for
 * ---------------------------------------------------------------------------
 *
 * `FAMILY_COLUMNS` was created to end exactly one bug, and its own comment said so: *"Adding
 * `recipe_layout` meant editing six strings, and a seventh call site that forgot one would return
 * a `Family` with the field quietly absent."* It consolidated six literal lists — and the seventh
 * site, the membership branch of `findFamilyForAccount`, kept its own hand-written list of five
 * columns, because it reads as un-substitutable inside `families!inner(...)`. It is not; the
 * filter is a string.
 *
 * So for five months every **invited** member resolved a household with `timezone`,
 * `avoided_allergens`, `kroger_location_id`, `recipe_layout` and `recipe_layout_asked_at` absent,
 * and `toFamily`'s defaults dressed the absences as choices. The allergen one was the expensive
 * half: the filter silently applied nothing, and the screen that edits the list seeded itself from
 * the empty value and would write it back.
 *
 * **A consolidation that covers six of seven sites reads as complete.** The site excluded was
 * excluded by *syntax*, not by oversight, so nobody re-counted — and the constant's existence
 * became the evidence that the problem was solved. A count of sites fixed is not a count of sites
 * covered, and the site that resists the pattern is the one that needed it most.
 *
 * ---------------------------------------------------------------------------
 * Why a guard and not only types
 * ---------------------------------------------------------------------------
 *
 * `FamilyRow` is required now, so a short select fails to compile — that is the stronger half and
 * it is mutation-tested in the type checker. This catches the case types cannot: a literal list
 * that happens to name all nine columns today and silently stops matching when a tenth is added.
 * The type is about *this* read; the guard is about the next column.
 *
 * Three outcomes, distinct exit codes: a check that cannot run must not look like one that passed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["packages/platform-client/src", "apps/web/app", "apps/web/lib"];
const CONSTANT = "FAMILY_COLUMNS";

/* the columns, so a literal list naming several of them is recognisable as one */
const COLUMNS = [
  "owner_account_id",
  "measurement_system",
  "avoided_allergens",
  "kroger_location_id",
  "recipe_layout",
  "recipe_layout_asked_at",
  "timezone",
];

const files = [];
for (const root of ROOTS) {
  if (!existsSync(root)) {
    console.error(`COULD NOT MEASURE: ${root} is not there`);
    process.exit(2);
  }
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(path)) files.push(path);
    }
  })(root);
}
if (files.length === 0) {
  console.error("COULD NOT MEASURE: no TypeScript files found under the roots");
  process.exit(2);
}

/*
 * A `.select("...")` whose literal names two or more family columns, anywhere. Two rather than one
 * because `owner_account_id` alone is a legitimate narrow read (`machine-auth` asks only whether a
 * family exists) and a settings list is never one column. Template literals using the constant are
 * matched first and skipped.
 */
const SELECT = /\.select\(\s*(`[^`]*`|"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*)/g;

const problems = [];
let checked = 0;
let viaConstant = 0;

for (const path of files) {
  const source = readFileSync(path, "utf8");
  for (const [, literal] of source.matchAll(SELECT)) {
    /*
     * Two kinds of "this is a family settings read", because the compliant form does not contain
     * the column names at all — it contains the constant. Looking only for column names found
     * nothing and the guard correctly reported COULD NOT MEASURE rather than a pass.
     */
    const throughConstant = literal.includes(CONSTANT);
    const named = COLUMNS.filter((column) => literal.includes(column));
    if (!throughConstant && named.length < 2) continue;
    checked++;
    if (throughConstant) {
      viaConstant++;
      continue;
    }
    problems.push(
      `${path}: a select lists family columns literally (${named.slice(0, 3).join(", ")}…).\n` +
        `      Use \`${CONSTANT}\` — interpolation works inside an embedded resource too:\n` +
        `        .select(\`family_id, families!inner(\${${CONSTANT}}, deleted_at)\`)\n` +
        `      A literal list is the seventh call site, and it goes quiet rather than wrong.`,
    );
  }
}

if (checked === 0) {
  console.error(
    "COULD NOT MEASURE: no select naming two or more family columns was found anywhere — " +
      "the pattern has drifted and this guard is reporting on nothing.",
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error(`${problems.length} family-select violation(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

console.log(
  `${checked} select(s) naming family columns; all ${viaConstant} go through ${CONSTANT}.`,
);
