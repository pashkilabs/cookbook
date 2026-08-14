#!/usr/bin/env node
/**
 * Grant one household an entitlement, by hand.
 *
 * **This is not billing and it is not a free tier.** Production issuance is a webhook that does
 * not exist yet, blocked on the billing decision. This is an operator granting access to a named
 * household, one at a time, on purpose — the deliberate opposite of
 * `PASHKI_DEV_ISSUE_ENTITLEMENT`, which grants it to whoever happens to sign up.
 *
 * That distinction is the whole reason this exists. The flag is a switch that says *everyone*;
 * with a public domain, no CAPTCHA and no IP rate limit on signup, that is an unpriced free tier
 * for anyone who finds the URL. This says *this household*, and leaves a record of who ran it.
 *
 * Three outcomes, with distinct exit codes:
 *   0  issued, or already matching
 *   1  refused — the address has no household, or the write failed
 *   2  could not measure — no credentials, or bad arguments
 *
 *   set -a && . ~/.pashki-supabase.env && set +a
 *   pnpm --filter @pashki/db issue:entitlement --email someone@example.com --dry-run
 *   pnpm --filter @pashki/db issue:entitlement --email someone@example.com --days 365 --imports 500
 */
import { readFileSync } from "node:fs";

const ISSUED = 0;
const REFUSED = 1;
const CANNOT_MEASURE = 2;

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const dryRun = argv.includes("--dry-run");

const email = flag("email")?.trim().toLowerCase();
const days = Number(flag("days", "365"));
const imports = Number(flag("imports", "500"));

if (!email || !Number.isInteger(days) || days <= 0 || !Number.isInteger(imports) || imports <= 0) {
  console.error("COULD NOT MEASURE: need --email, and --days/--imports must be whole numbers.");
  console.error("  pnpm --filter @pashki/db issue:entitlement --email someone@example.com");
  process.exit(CANNOT_MEASURE);
}

/**
 * The hosted project's own keys, read from the app's env file.
 *
 * Deliberately the *service role*, and deliberately not the management token: this writes a row
 * in a platform table, which is `packages/db`'s to write and nothing else's.
 */
function credentials() {
  for (const path of [new URL("../../../apps/web/.env.local", import.meta.url)]) {
    try {
      const text = readFileSync(path, "utf8");
      const env = Object.fromEntries(
        text
          .split("\n")
          .filter((line) => line.includes("=") && !line.startsWith("#"))
          .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
      );
      if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
        return { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
      }
    } catch {
      // fall through to the environment
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

const creds = credentials();
if (!creds) {
  console.error("COULD NOT MEASURE: no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(CANNOT_MEASURE);
}

const headers = {
  apikey: creds.key,
  Authorization: `Bearer ${creds.key}`,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const response = await fetch(`${creds.url}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// auth user -> membership -> household. An address with no household is a refusal, not a
// silently created one: provisioning happens at first confirmed sign-in and nowhere else.
const users = await api("/auth/v1/admin/users?per_page=200");
const user = (users.users ?? []).find((candidate) => (candidate.email ?? "").toLowerCase() === email);
if (!user) {
  console.error(`REFUSED: no account for ${email}.`);
  process.exit(REFUSED);
}

const members = await api(
  `/rest/v1/family_members?account_id=eq.${user.id}&deleted_at=is.null&select=family_id,display_name`,
);
if (!members.length) {
  console.error(`REFUSED: ${email} belongs to no household.`);
  console.error("  Provisioning runs at first confirmed sign-in — sign in once, then run this.");
  process.exit(REFUSED);
}

const familyId = members[0].family_id;
const [family] = await api(`/rest/v1/families?id=eq.${familyId}&select=id,name`);

const validUntil = new Date(Date.now() + days * 86400000).toISOString();
// mirrors DEFAULT_GRACE_DAYS in the seam: a week of read-only after expiry rather than a cliff
const graceUntil = new Date(Date.now() + (days + 7) * 86400000).toISOString();

const existing = await api(
  `/rest/v1/entitlements?family_id=eq.${familyId}&app_key=eq.recipes&select=tier,valid_until,quota_json`,
);

console.log(`household  ${family?.name ?? "(unnamed)"}  ${familyId}`);
console.log(`member     ${members[0].display_name} <${email}>`);
console.log(`current    ${existing.length ? JSON.stringify(existing[0]) : "(no entitlement)"}`);
console.log(`issuing    tier=full  valid_until=${validUntil.slice(0, 10)}  imports=${imports}/30 days`);

if (dryRun) {
  console.log("\nDRY RUN: nothing was written.");
  process.exit(ISSUED);
}

await api("/rest/v1/entitlements?on_conflict=family_id,app_key", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify({
    family_id: familyId,
    app_key: "recipes",
    tier: "full",
    quota_json: { imports: { limit: imports, used: 0, resetsAt: null, periodDays: 30 } },
    valid_until: validUntil,
    grace_until: graceUntil,
  }),
});

// read back rather than trusting the write — an upsert that matched nothing still returns 2xx
const after = await api(
  `/rest/v1/entitlements?family_id=eq.${familyId}&app_key=eq.recipes&select=tier,valid_until,grace_until,quota_json`,
);
if (!after.length) {
  console.error("\nREFUSED: the upsert reported success and the row is not there.");
  process.exit(REFUSED);
}

console.log(`\nISSUED: ${JSON.stringify(after[0])}`);
console.log("  An operator grant, not billing. It expires; it is not a subscription.");
process.exit(ISSUED);
