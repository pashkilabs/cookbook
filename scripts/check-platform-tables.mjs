/**
 * Fail if anything outside the seam queries a platform table.
 *
 * The app must never touch `accounts`, `families`, `family_members`, `devices`,
 * `subscriptions`, `entitlements` or `invitations` directly — it goes through
 * `@pashki/platform-client`. That boundary is what makes extracting a real platform
 * for app #2 mechanical instead of surgical, and nothing in the database can enforce
 * it: RLS stops a household reading another's rows, not the recipe app reading its
 * own family table. So it is enforced here.
 *
 *   node scripts/check-platform-tables.mjs
 */
import { lineOf, sourceFiles, stripComments } from "./lib/source-files.mjs";

const root = new URL("..", import.meta.url).pathname;

const PLATFORM_TABLES = [
  "accounts",
  "families",
  "family_members",
  "devices",
  "subscriptions",
  "entitlements",
  // added with adult invitations: it holds a token hash and decides household membership,
  // which is exactly the kind of table app code must reach only through the seam
  "invitations",
];

/**
 * Who may.
 *
 * - the seam itself, which is the whole point
 * - packages/db, which defines the schema and whose tests prove the RLS on it
 * - this checker, which has to name the tables to look for them
 */
const ALLOWED_PREFIXES = [
  "packages/platform-client/",
  "packages/db/",
  "scripts/check-platform-tables.mjs",
];

/** `.from("accounts")` — the supabase-js shape. */
const clientQuery = (table) => new RegExp(String.raw`\.from\(\s*["'\`]${table}["'\`]`);

/** `from accounts`, `join public.families`, `update devices` — raw SQL in a string. */
const rawSql = (table) =>
  new RegExp(String.raw`\b(?:from|join|into|update)\s+(?:public\.)?${table}\b`, "i");

const offenders = [];

for (const { path, source } of sourceFiles(root)) {
  if (ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
  // A test outside the seam is still a test, but it should not be teaching the app
  // to query platform tables — so tests are NOT exempt here, unlike the catalog
  // guard. The exception is packages/db above, which owns the schema.
  const code = stripComments(source);

  for (const table of PLATFORM_TABLES) {
    for (const pattern of [clientQuery(table), rawSql(table)]) {
      if (!pattern.test(code)) continue;
      offenders.push({ path, line: lineOf(source, pattern), table });
      break;
    }
  }
}

if (offenders.length > 0) {
  console.error("platform tables are queried outside @pashki/platform-client:\n");
  for (const { path, line, table } of offenders) {
    console.error(`  ${path}:${line}  (${table})`);
  }
  console.error(
    "\nGo through @pashki/platform-client instead: getSession, getEntitlement," +
      "\nconsumeQuota, registerDevice. If the seam is missing something, widen the" +
      "\nseam — that is the decision worth making deliberately.",
  );
  process.exit(1);
}

console.log(
  `platform tables (${PLATFORM_TABLES.length}) are queried only inside the seam and packages/db.`,
);
