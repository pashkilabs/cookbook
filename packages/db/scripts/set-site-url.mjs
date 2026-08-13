#!/usr/bin/env node
/**
 * Point hosted auth at where the app actually lives.
 *
 * GoTrue builds the link in a confirmation email from `site_url`. Left at `localhost:3000`, mail
 * sends perfectly and every recipient gets a link to their own machine — a failure that looks
 * like success from every angle except the only one that matters.
 *
 * It also matches `redirect_to` against `uri_allow_list`, and **a path under `site_url` is not
 * implied**. An unlisted redirect is not an error: it is silently replaced with `site_url`, so
 * the link goes somewhere plausible and wrong. Both are set here, together, because setting
 * one without the other is the shape of that bug.
 *
 * Local entries are **kept**, not replaced. Development still redirects to localhost, and a
 * script that quietly broke `pnpm dev` to fix production would be trading one silence for
 * another.
 *
 * Three outcomes, with distinct exit codes:
 *   0  applied, or already matching
 *   1  the management API refused, or applied less than it accepted
 *   2  could not measure — no token, no linked project, or a URL that is not one
 *
 *   set -a && . ~/.pashki-supabase.env && set +a
 *   pnpm --filter @pashki/db set:site-url https://app.pashki.com --dry-run
 *   pnpm --filter @pashki/db set:site-url https://app.pashki.com
 */
import { execFileSync } from "node:child_process";

const APPLIED = 0;
const REFUSED = 1;
const CANNOT_MEASURE = 2;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const given = args.find((arg) => !arg.startsWith("--"));

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

async function readHosted(ref, token) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { ok: false, detail: `the management API answered ${response.status}` };
  return { ok: true, config: await response.json() };
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("COULD NOT MEASURE: SUPABASE_ACCESS_TOKEN is not set.");
  console.error("  set -a && . ~/.pashki-supabase.env && set +a");
  process.exit(CANNOT_MEASURE);
}

if (!given) {
  console.error("COULD NOT MEASURE: no URL given.");
  console.error("  pnpm --filter @pashki/db set:site-url https://app.pashki.com");
  process.exit(CANNOT_MEASURE);
}

let site;
try {
  const parsed = new URL(given);
  if (parsed.protocol !== "https:") throw new Error("not https");
  // no trailing slash: the app strips one from NEXT_PUBLIC_SITE_URL, and the two must agree
  site = `${parsed.protocol}//${parsed.host}`;
} catch {
  console.error(`COULD NOT MEASURE: ${given} is not an https URL.`);
  console.error("  Confirmation links are mailed to strangers; http is not good enough for one.");
  process.exit(CANNOT_MEASURE);
}

const ref = linkedProjectRef();
if (!ref) {
  console.error("COULD NOT MEASURE: no linked project. Run from packages/db.");
  process.exit(CANNOT_MEASURE);
}

const before = await readHosted(ref, token);
if (!before.ok) {
  console.error(`COULD NOT MEASURE: ${before.detail}`);
  process.exit(CANNOT_MEASURE);
}

/*
 * The glob, not the bare origin. GoTrue matches the whole `redirect_to`, and the app sends
 * `${site}/auth/confirm` — an allow list carrying only the origin rejects that and silently
 * substitutes `site_url`, which is precisely the trap this exists to close.
 */
const existing = String(before.config.uri_allow_list ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const wanted = `${site}/**`;
const allowList = [wanted, ...existing.filter((entry) => entry !== wanted)].join(",");

const settings = { site_url: site, uri_allow_list: allowList };

console.log(`project ${ref}`);
for (const [key, value] of Object.entries(settings)) {
  const was = String(before.config[key] ?? "(not set)");
  const mark = was === value ? "  " : " *";
  console.log(`${mark} ${key.padEnd(16)} ${was === value ? value : `${was}\n${" ".repeat(19)}->  ${value}`}`);
}

if (dryRun) {
  console.log("\nDRY RUN: nothing was sent.");
  process.exit(APPLIED);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(settings),
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  console.error(`\nREFUSED: the management API answered ${response.status}`);
  console.error(`  ${(await response.text().catch(() => "")).slice(0, 300)}`);
  process.exit(REFUSED);
}

// read back rather than trusting the 200 — a PATCH that ignores a field still returns one
const after = await readHosted(ref, token);
if (!after.ok) {
  console.error(`\nAPPLIED, BUT UNVERIFIED: ${after.detail}`);
  process.exit(REFUSED);
}

const wrong = Object.entries(settings).filter(([key, value]) => String(after.config[key] ?? "") !== value);
if (wrong.length > 0) {
  console.error("\nREFUSED: accepted the request and did not apply everything.");
  for (const [key, value] of wrong) {
    console.error(`  ${key}: asked for ${value}, still ${after.config[key] ?? "(not set)"}`);
  }
  process.exit(REFUSED);
}

console.log("\nAPPLIED: confirmation links now point at the deployed app.");
console.log("  Prove it: register a new address and click the link in the email.");
console.log(`  NEXT_PUBLIC_SITE_URL on the host must match exactly: ${site}`);
process.exit(APPLIED);
