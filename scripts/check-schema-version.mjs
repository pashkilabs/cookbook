/**
 * Does `REQUIRED_MIGRATION` name the newest migration in the repository?
 *
 * ---------------------------------------------------------------------------
 * Why this is a build guard and not a rule
 * ---------------------------------------------------------------------------
 *
 * `/api/health` reports `schema` by comparing `REQUIRED_MIGRATION` against what the database has
 * applied, and exists because `git push` deploys while `db:push` is remembered by a person. That
 * asymmetry had shipped code ahead of its schema four times.
 *
 * It then happened a **fifth** time, and the health check said `schema: ok` throughout — because
 * the stamp was stale. Two migrations landed, the seam's select list grew a column hosted did not
 * have, every provisioning request 500'd, and the one mechanism built to catch exactly this
 * reported green because nobody had turned the stamp.
 *
 * `schema-version.ts` argued against computing the constant: *"computing it from the migrations
 * directory would make it always correct and therefore never informative"*. That reasoning is
 * wrong, and it is worth saying why rather than just replacing it. The constant describes **the
 * build**; the comparison is against **the database**. Deriving it from the repository makes it
 * always correct about the build and leaves the interesting question — has the database caught up
 * — exactly as open as before.
 *
 * What the old reasoning was really protecting against is a migration no code depends on raising
 * a warning. That is a **false alarm, not a false ok**: it costs a `db:push`, where the other
 * costs production. Five instances is enough to know which way to err.
 *
 * ---------------------------------------------------------------------------
 * Three outcomes
 * ---------------------------------------------------------------------------
 *
 *   0  the stamp names the newest migration
 *   1  it does not — named, with the line to change
 *   2  could not measure: no migrations directory, or no constant to read. A check that cannot
 *      run must not look like one that passed.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const migrations = path.join(root, "packages/db/supabase/migrations");
const stampFile = path.join(root, "apps/web/lib/schema-version.ts");

let files;
try {
  files = readdirSync(migrations).filter((name) => name.endsWith(".sql"));
} catch (error) {
  console.error(`COULD NOT MEASURE: ${migrations} is unreadable: ${error.message}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error(`COULD NOT MEASURE: no .sql migrations in ${migrations}`);
  process.exit(2);
}

// filenames are timestamp-prefixed, so lexicographic order is chronological order
const newest = files.sort().at(-1).replace(/\.sql$/, "");

let source;
try {
  source = readFileSync(stampFile, "utf8");
} catch (error) {
  console.error(`COULD NOT MEASURE: ${stampFile} is unreadable: ${error.message}`);
  process.exit(2);
}
const found = /REQUIRED_MIGRATION\s*=\s*"([^"]+)"/.exec(source);
if (!found) {
  console.error(`COULD NOT MEASURE: no REQUIRED_MIGRATION string literal in ${stampFile}`);
  process.exit(2);
}
const stamped = found[1];

if (stamped !== newest) {
  console.error(`REQUIRED_MIGRATION is stale.`);
  console.error(`  stamped: ${stamped}`);
  console.error(`  newest:  ${newest}`);
  console.error("");
  console.error(`/api/health compares this against the database, so a stale stamp makes it report`);
  console.error(`"schema: ok" for a build the database has not caught up with — which is how code`);
  console.error(`reached production ahead of its schema a fifth time, with the guard green.`);
  console.error("");
  console.error(`Fix: set REQUIRED_MIGRATION in apps/web/lib/schema-version.ts to "${newest}",`);
  console.error(`and push the migration with  pnpm --filter @pashki/db db:push`);
  process.exit(1);
}

console.log(`REQUIRED_MIGRATION names the newest migration (${files.length} migrations).`);
