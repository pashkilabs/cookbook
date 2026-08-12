/**
 * Fail if anything outside seeding and tests depends on SEED_CATALOG.
 *
 * The catalog is data, not code: it lives in the `ingredients` and
 * `grocery_packages` tables, and production builds it with `createCatalog()` from
 * whatever the database holds so it can be corrected without a release. Code that
 * reaches for the constant instead is code that silently ignores every correction
 * anyone makes.
 *
 * Comments are stripped before searching, so prose about the catalog is fine —
 * only a real reference in code counts.
 *
 *   node scripts/check-seed-catalog-usage.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const NEEDLE = "SEED_CATALOG";
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", ".turbo", "dist", "build", ".next", "coverage"]);

/**
 * Where the constant may legitimately be referenced.
 *
 * Tests are allowed because the round-trip test's whole job is comparing the
 * database against the constant.
 */
const ALLOWED = [
  // the definition and its re-export
  "packages/core/src/seed-catalog.ts",
  "packages/core/src/index.ts",
  // seeding
  "packages/db/scripts/generate-seed.ts",
  // this checker names the constant to look for it
  "scripts/check-seed-catalog-usage.mjs",
];

const isTest = (path) => /(^|\/)test(s)?\//.test(path) || /\.(test|spec)\.[a-z]+$/.test(path);
const isAllowed = (path) => ALLOWED.includes(path) || isTest(path);

/** Remove block and line comments so prose mentions do not count as usage. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!CODE.test(entry)) continue;

    const path = relative(root, full);
    const source = readFileSync(full, "utf8");
    if (!source.includes(NEEDLE)) continue;
    if (isAllowed(path)) continue;
    if (!stripComments(source).includes(NEEDLE)) continue;

    const line = source.split("\n").findIndex((l) => l.includes(NEEDLE)) + 1;
    offenders.push(`${path}:${line}`);
  }
}

walk(root);

if (offenders.length > 0) {
  console.error(`${NEEDLE} is referenced outside seeding and tests:\n`);
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error(
    `\nThe catalog is data. Load it with createCatalog() from the ingredients and` +
      `\ngrocery_packages tables so corrections take effect without a release.`,
  );
  process.exit(1);
}

console.log(`${NEEDLE} is referenced only by its definition, seeding and tests.`);
