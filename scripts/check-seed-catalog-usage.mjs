/**
 * Fail if anything outside seeding and tests depends on SEED_CATALOG.
 *
 * The catalog is data, not code: it lives in the `ingredients` and
 * `grocery_packages` tables, and production builds it with `createCatalog()` from
 * whatever the database holds so it can be corrected without a release. Code that
 * reaches for the constant instead is code that silently ignores every correction
 * anyone makes.
 *
 *   node scripts/check-seed-catalog-usage.mjs
 */
import { isTestFile, lineOf, sourceFiles, stripComments } from "./lib/source-files.mjs";

const root = new URL("..", import.meta.url).pathname;
const NEEDLE = "SEED_CATALOG";
const PATTERN = /SEED_CATALOG/;

/**
 * Where the constant may legitimately be referenced. Tests are allowed because the
 * round-trip test's whole job is comparing the database against the constant.
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

const offenders = [];

for (const { path, source } of sourceFiles(root)) {
  if (ALLOWED.includes(path) || isTestFile(path)) continue;
  if (!source.includes(NEEDLE)) continue;
  if (!stripComments(source).includes(NEEDLE)) continue;
  offenders.push(`${path}:${lineOf(source, PATTERN)}`);
}

if (offenders.length > 0) {
  console.error(`${NEEDLE} is referenced outside seeding and tests:\n`);
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error(
    "\nThe catalog is data. Load it with createCatalog() from the ingredients and" +
      "\ngrocery_packages tables so corrections take effect without a release.",
  );
  process.exit(1);
}

console.log(`${NEEDLE} is referenced only by its definition, seeding and tests.`);
