/**
 * Is every local migration already applied to hosted? Run **before pushing**, not during `check`.
 *
 * ---------------------------------------------------------------------------
 * Why this is not part of `pnpm check`
 * ---------------------------------------------------------------------------
 *
 * `git push` deploys and `db:push` is remembered by a person, and that asymmetry has put code in
 * production ahead of its schema **six times**. `/api/health` catches it — it reported
 * `MISSING 20261011090000_kroger_export` with the fixing command — but catching is not
 * preventing, and the catch happens after the outage.
 *
 * It cannot live in `pnpm check`, though, and the reason matters: during normal work the migration
 * exists locally *first*. You write the schema, then the code, then push both. A check that
 * refuses any local-but-not-hosted migration would fail on every machine mid-feature, and a check
 * that fails routinely is one people learn to ignore — which is worse than no check.
 *
 * So it is a **pre-push** question. `pnpm ship` runs it as part of pushing in the right order,
 * which removes the ordering decision rather than policing it.
 *
 * Three outcomes. A migration missing from hosted is 1. An unreachable database is **2, not 0** —
 * a check that cannot run must not look like one that passed, and this one cannot run at all
 * without credentials.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "packages/db/supabase/migrations");

/* the env file is the project's own convention; a shell export does not survive into a subprocess */
const fromEnvFile = (file) => {
  try {
    const out = {};
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const at = line.indexOf("=");
      if (at > 0 && !line.trimStart().startsWith("#")) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
};
const local = { ...fromEnvFile(path.join(root, "apps/web/.env.local")), ...process.env };
const url = local.NEXT_PUBLIC_SUPABASE_URL;
const key = local.SUPABASE_SERVICE_ROLE_KEY;

let versions;
try {
  versions = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ version: name.split("_")[0], name: name.replace(/\.sql$/, "") }));
} catch (error) {
  console.error(`COULD NOT MEASURE: ${dir} is unreadable: ${error.message}`);
  process.exit(2);
}
if (versions.length === 0) {
  console.error(`COULD NOT MEASURE: no migrations in ${dir}`);
  process.exit(2);
}

if (!url || !key) {
  console.error("COULD NOT MEASURE: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY needed.");
  console.error("Without them this cannot tell a pushed migration from an unpushed one.");
  process.exit(2);
}

let applied;
try {
  const response = await fetch(`${url}/rest/v1/rpc/applied_migration_versions`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    console.error(`COULD NOT MEASURE: applied migrations came back ${response.status}`);
    process.exit(2);
  }
  applied = new Set(await response.json());
} catch (error) {
  console.error(`COULD NOT MEASURE: the database did not answer: ${error.message}`);
  process.exit(2);
}

const missing = versions.filter((migration) => !applied.has(migration.version));
if (missing.length > 0) {
  console.error(`${missing.length} migration(s) exist locally and NOT on hosted:`);
  for (const migration of missing) console.error(`  ${migration.name}`);
  console.error("");
  console.error("`git push` deploys. If the code being pushed needs one of these, the deployment");
  console.error("will serve pages against a schema that does not have them — which has happened");
  console.error("six times, each surfacing as a server-side exception rather than a failed build.");
  console.error("");
  console.error("  pnpm --filter @pashki/db db:push:dry   # always first");
  console.error("  pnpm --filter @pashki/db db:push");
  console.error("  pnpm --filter @pashki/db check:parity   # always after");
  process.exit(1);
}

console.log(`every one of the ${versions.length} local migrations is applied on hosted.`);
