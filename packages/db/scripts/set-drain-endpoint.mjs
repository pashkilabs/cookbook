#!/usr/bin/env node
/**
 * Tell the scheduler where to knock, and with what.
 *
 * The migration builds the mechanism — the tick, the predicate, the cron entry — and deliberately
 * leaves `private.import_drain_config` empty, because the shared secret must not be in git. Until
 * this runs, every tick reports `not-configured` rather than doing nothing quietly.
 *
 * Three outcomes, with distinct exit codes:
 *   0  configured, or already matching
 *   1  refused — the write failed, or read back wrong
 *   2  could not measure — no credentials, or bad arguments
 *
 *   set -a && . ~/.pashki-supabase.env && set +a
 *   pnpm --filter @pashki/db set:drain-endpoint https://cookbook.pashki.com/api/import/drain --dry-run
 *   pnpm --filter @pashki/db set:drain-endpoint https://cookbook.pashki.com/api/import/drain
 *
 * The secret comes from `PASHKI_DRAIN_SECRET` and must match the same variable on the web host.
 * Generate one with `openssl rand -hex 32`. It is never printed here.
 */
import { execFileSync } from "node:child_process";

const CONFIGURED = 0;
const REFUSED = 1;
const CANNOT_MEASURE = 2;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const local = argv.includes("--local");
const given = argv.find((arg) => !arg.startsWith("--"));

const secret = process.env.PASHKI_DRAIN_SECRET;
if (!secret) {
  console.error("COULD NOT MEASURE: PASHKI_DRAIN_SECRET is not set.");
  console.error("  Generate one with: openssl rand -hex 32");
  console.error("  It must match PASHKI_DRAIN_SECRET on the web host, or every tick gets a 401.");
  process.exit(CANNOT_MEASURE);
}
if (secret.length < 32) {
  // a machine presents this on every tick; a guessable one is a way to spend a household's quota
  console.error(`COULD NOT MEASURE: PASHKI_DRAIN_SECRET is ${secret.length} characters, want at least 32.`);
  process.exit(CANNOT_MEASURE);
}

let endpoint;
try {
  const url = new URL(given ?? "");
  if (!local && url.protocol !== "https:") throw new Error("not https");
  if (!url.pathname.endsWith("/api/import/drain")) throw new Error("not the drain route");
  endpoint = url.toString();
} catch {
  console.error(`COULD NOT MEASURE: ${given ?? "(no URL)"} is not a drain endpoint.`);
  console.error("  Expected https://<host>/api/import/drain — the secret travels in a header,");
  console.error("  so plain http would put it on the wire in clear. Pass --local to allow http.");
  process.exit(CANNOT_MEASURE);
}

/**
 * Written over psql rather than PostgREST, because `private` is not a schema the API exposes and
 * must not become one. Locally that is the container; against hosted it is a connection string.
 */
function run(sql) {
  const target = process.env.SUPABASE_DB_URL ?? hostedUrlFromPassword();
  const args = target
    ? ["exec", "-i", "supabase_db_db", "psql", target, "-q", "-v", "ON_ERROR_STOP=1", "-tAc", sql]
    : ["exec", "-i", "supabase_db_db", "psql", "-U", "postgres", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-tAc", sql];
  return execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();
}

function hostedUrlFromPassword() {
  if (local) return null;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) return null;
  const ref = linkedProjectRef();
  if (!ref) return null;
  const region = process.env.SUPABASE_DB_REGION ?? "ca-central-1";
  // percent-encoded: the CLI's own --password flag truncates this password at its '#'
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:5432/postgres`;
}

function linkedProjectRef() {
  try {
    const raw = execFileSync("npx", ["supabase", "projects", "list", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60_000,
      cwd: new URL("..", import.meta.url).pathname,
    });
    const parsed = JSON.parse(raw);
    const projects = Array.isArray(parsed) ? parsed : parsed.projects;
    return projects?.find((project) => project.linked)?.ref ?? null;
  } catch {
    return null;
  }
}

const escaped = (value) => `'${String(value).replace(/'/g, "''")}'`;

let before;
try {
  before = run("select coalesce((select drain_endpoint from private.scheduler_config limit 1), '(not set)')");
} catch (error) {
  console.error("COULD NOT MEASURE: could not reach the database.");
  console.error(`  ${String(error.message).slice(0, 200)}`);
  process.exit(CANNOT_MEASURE);
}

/*
 * The reaper's endpoint is derived rather than asked for. Both scheduled jobs call the same
 * deployment with the same secret, and a second argument would be a second thing to get wrong —
 * this session has already lost an afternoon to one secret configured twice.
 */
const reaperEndpoint = endpoint.replace(/\/api\/import\/drain$/, "/api/photos/reap");

console.log(`drain     ${before}`);
console.log(`          ->  ${endpoint}`);
console.log(`reaper    ->  ${reaperEndpoint}`);
console.log("secret    (set, not printed)");

if (dryRun) {
  console.log("\nDRY RUN: nothing was written.");
  process.exit(CONFIGURED);
}

try {
  run(
    `insert into private.scheduler_config (id, drain_endpoint, reaper_endpoint, secret, updated_at)
     values (true, ${escaped(endpoint)}, ${escaped(reaperEndpoint)}, ${escaped(secret)}, now())
     on conflict (id) do update set drain_endpoint = excluded.drain_endpoint,
       reaper_endpoint = excluded.reaper_endpoint, secret = excluded.secret, updated_at = now()`,
  );
} catch (error) {
  console.error(`\nREFUSED: the write failed — ${String(error.message).slice(0, 200)}`);
  process.exit(REFUSED);
}

// read back rather than trusting the insert; the secret is compared by length and match, never shown
const check = run(
  `select json_build_object('endpoint', drain_endpoint, 'reaper', reaper_endpoint,
     'secret_matches', secret = ${escaped(secret)})::text
   from private.scheduler_config limit 1`,
);
const parsed = JSON.parse(check);
if (parsed.endpoint !== endpoint || parsed.secret_matches !== true) {
  console.error("\nREFUSED: the row does not match what was asked for.");
  console.error(`  endpoint: ${parsed.endpoint}`);
  process.exit(REFUSED);
}

console.log("\nCONFIGURED: the scheduler has somewhere to send work.");
console.log("  PASHKI_DRAIN_SECRET must be set to the same value on the web host, or every tick 401s.");
console.log("  Watch it work:  select * from cron.job_run_details order by start_time desc limit 5;");
process.exit(CONFIGURED);
