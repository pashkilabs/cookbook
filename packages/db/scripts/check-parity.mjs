#!/usr/bin/env node
/**
 * Does the hosted project match the local one?
 *
 * Two halves, because both have now produced a bug. The **database** half compares schema and
 * privileges. The **auth** half compares GoTrue settings, and exists because the second
 * asymmetry to bite was not in the schema: local had email confirmation off while hosted
 * requires it, so every negative test about unconfirmed accounts passed for the wrong reason.
 *
 * Every migration is written and tested against the local image, which narrows the
 * default ACL for client roles. Hosted Supabase does the opposite — `ALTER DEFAULT
 * PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated` — so a migration that is
 * green locally can still land a hole in production. The first hosted push proved it:
 * `import_cache` was readable by `anon`. **A local-only green is not evidence.**
 *
 * So this asks both environments a byte-identical set of questions (`scripts/parity.sql`)
 * and reports where the answers differ. It reports; it does not fix. A difference is a
 * decision, and the decision belongs in a migration.
 *
 * Three outcomes, with distinct exit codes, because "no differences found" and "could
 * not ask" are not the same answer:
 *
 *   0  parity            — both answered, every answer matches
 *   1  differences       — both answered, some answers differ
 *   2  could not measure — one or both could not be reached
 *
 * The invariants are asked of each environment separately rather than inside the shared
 * question set: `assert_rls_invariants()` raises, and one raise under ON_ERROR_STOP would
 * abandon the whole comparison — reporting a specific, known failure as "could not
 * measure the comparison".
 *
 * Run it after every push:
 *   pnpm --filter @pashki/db check:parity
 *
 * Hosted credentials come from the environment and are never printed:
 *   SUPABASE_DB_URL       a full connection string, already percent-encoded
 *   SUPABASE_DB_PASSWORD  raw password; the pooler URL is built from the linked ref
 *   SUPABASE_ACCESS_TOKEN needed for the auth half — the management API is the only way to read
 *                         hosted auth settings, and without it that half reports
 *                         could-not-measure rather than quietly comparing nothing
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { compareAuthSettings } from "./auth-parity.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const questions = join(here, "parity.sql");

const PARITY = 0;
const DIFFERENCES = 1;
const CANNOT_MEASURE = 2;

/**
 * psql runs inside the local Postgres container, which is the only place it is
 * guaranteed to exist. It reaches the hosted database over the pooler — the direct host
 * resolves to IPv6 only, which the container cannot route.
 */
const CONTAINER = process.env.PASHKI_DB_CONTAINER ?? "supabase_db_db";

function ask(target) {
  const sql = readFileSync(questions, "utf8");
  const args = ["exec", "-i", CONTAINER, "psql"];
  args.push(...(target.url ? [target.url] : ["-U", "postgres", "-d", "postgres"]));
  // -A -t -F set the format here so the question set contains no \pset echo
  args.push("-A", "-t", "-F", "|", "-v", "ON_ERROR_STOP=1", "-f", "-");

  let raw;
  try {
    raw = execFileSync("docker", args, {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    const stderr = (error.stderr ?? "").trim().replace(/\s+/g, " ");
    return { ok: false, detail: stderr.slice(-300) || `psql exited ${error.status ?? "?"}` };
  }

  const answers = new Map();
  for (const line of raw.split("\n")) {
    const separator = line.indexOf("|");
    if (separator < 1) continue;
    answers.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return answers.size > 0
    ? { ok: true, answers }
    : { ok: false, detail: "psql returned no rows — the question set did not run" };
}

function linkedProjectRef() {
  const refFile = join(packageRoot, "supabase", ".temp", "project-ref");
  if (!existsSync(refFile)) return null;
  return readFileSync(refFile, "utf8").trim() || null;
}

/** Build the hosted connection string without ever printing it. */
function hostedTarget() {
  if (process.env.SUPABASE_DB_URL) return { url: process.env.SUPABASE_DB_URL };

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) return null;

  const ref = linkedProjectRef();
  if (!ref) return null;

  const region = process.env.SUPABASE_DB_REGION ?? "ca-central-1";
  const encoded = encodeURIComponent(password);
  return {
    url: `postgresql://postgres.${ref}:${encoded}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
  };
}

const local = ask({});
const hostedConfig = hostedTarget();

if (!hostedConfig) {
  console.error("COULD NOT MEASURE: no hosted credentials.");
  console.error("  Set SUPABASE_DB_URL, or SUPABASE_DB_PASSWORD with a linked project.");
  console.error("  Nothing was compared, which is not the same as nothing being wrong.");
  process.exit(CANNOT_MEASURE);
}

const hosted = ask(hostedConfig);

for (const [name, result] of [
  ["local", local],
  ["hosted", hosted],
]) {
  if (!result.ok) {
    console.error(`COULD NOT MEASURE: ${name} did not answer — ${result.detail}`);
    if (name === "local") {
      console.error("  Is the local stack running? pnpm --filter @pashki/db db:start");
    }
    process.exit(CANNOT_MEASURE);
  }
}

/** Null when the invariants hold, otherwise the reason. Asked per environment. */
function invariants(target) {
  const args = ["exec", "-i", CONTAINER, "psql"];
  args.push(...(target.url ? [target.url] : ["-U", "postgres", "-d", "postgres"]));
  args.push("-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", "select private.assert_rls_invariants();");
  try {
    execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return null;
  } catch (error) {
    const stderr = (error.stderr ?? "").trim().replace(/\s+/g, " ");
    return stderr.slice(0, 300) || "assert_rls_invariants() failed with no message";
  }
}

const broken = [
  ["local", invariants({})],
  ["hosted", invariants(hostedConfig)],
].filter(([, reason]) => reason !== null);

const verbose = process.argv.includes("--verbose");
/** The detail row is long and only worth showing when its digest disagrees, or on request. */
const DETAIL = "client_write_columns_detail";
const keys = [...new Set([...local.answers.keys(), ...hosted.answers.keys()])]
  .filter((key) => key !== DETAIL || verbose)
  .sort();
const compared = [...new Set([...local.answers.keys(), ...hosted.answers.keys()])].sort();
const differences = compared
  .map((key) => ({
    key,
    local: local.answers.get(key) ?? "(absent)",
    hosted: hosted.answers.get(key) ?? "(absent)",
  }))
  .filter((row) => row.local !== row.hosted);

console.log("DATABASE");
const width = Math.max(...keys.map((key) => key.length));
for (const key of keys) {
  const mine = local.answers.get(key) ?? "(absent)";
  const theirs = hosted.answers.get(key) ?? "(absent)";
  const mark = mine === theirs ? "  " : "!!";
  console.log(`${mark} ${key.padEnd(width)}  local=${mine}  hosted=${theirs}`);
}

console.log("-".repeat(width + 40));
console.log("");

console.log("AUTH SETTINGS");
const auth = await compareAuthSettings({
  projectRef: linkedProjectRef(),
  accessToken: process.env.SUPABASE_ACCESS_TOKEN,
});

if (!auth.ok) {
  console.error(`COULD NOT MEASURE: auth settings — ${auth.detail}`);
  console.error("  The database half may have compared fine. This half did not run, which is");
  console.error("  not the same as it having found nothing.");
  process.exit(CANNOT_MEASURE);
}

const authWidth = Math.max(...auth.rows.map((row) => row.key.length));
const unexpected = auth.rows.filter((row) => row.differs && !row.expectedToDiffer);
for (const row of auth.rows) {
  const mark = !row.differs ? "  " : row.expectedToDiffer ? "~~" : "!!";
  console.log(`${mark} ${row.key.padEnd(authWidth)}  local=${row.local}  hosted=${row.hosted}`);
}
const expectedDiffs = auth.rows.filter((row) => row.differs && row.expectedToDiffer);
if (expectedDiffs.length > 0) {
  console.log("");
  console.log("~~ differs on purpose:");
  for (const row of expectedDiffs) console.log(`     ${row.key}: ${row.expectedToDiffer}`);
}
console.log("-".repeat(authWidth + 40));

for (const [environment, reason] of broken) {
  console.log(`INVARIANT BROKEN (${environment}): ${reason}`);
}

if (differences.length === 0 && broken.length === 0 && unexpected.length === 0) {
  console.log(
    `PARITY: ${compared.length} database checks and ${auth.rows.length} auth settings, ` +
      `no unexpected differences, invariants hold in both.`,
  );
  process.exit(PARITY);
}

if (differences.length > 0) {
  console.log(`DIFFERENCES (database): ${differences.length} of ${compared.length} checks disagree.`);
  for (const row of differences) console.log(`  ${row.key}: local=${row.local} hosted=${row.hosted}`);
}
if (unexpected.length > 0) {
  console.log(`DIFFERENCES (auth): ${unexpected.length} setting(s) differ with no stated reason.`);
  for (const row of unexpected) console.log(`  ${row.key}: local=${row.local} hosted=${row.hosted}`);
}
if (differences.length === 0 && unexpected.length === 0) {
  console.log("No differences between the environments — they are broken identically.");
}
console.log("");
console.log("Not fixed on purpose. A difference is a decision — put it in a migration or in");
console.log("supabase/config.toml, apply it, then run this again. If it is meant to differ, say");
console.log("so in scripts/auth-parity.mjs with the reason.");
process.exit(DIFFERENCES);
