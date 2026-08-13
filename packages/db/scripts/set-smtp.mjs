#!/usr/bin/env node
/**
 * Point hosted auth at a real mail provider.
 *
 * Without one, Supabase sends through a shared address at **two emails per hour for the whole
 * project** — not per user. That is enough to test a signup and nothing else: the third person
 * to register today does not get a confirmation link, and there is no error to see, because the
 * send is refused after the account is created. Public signup cannot open until this is set.
 *
 * **A script rather than the dashboard**, for the same reason `check:parity` exists at all.
 * Configuration made by clicking is configuration nobody can review, reproduce, or notice
 * drifting. This is reviewable, re-runnable, and prints what it changed.
 *
 * Three outcomes, with distinct exit codes, because "already correct" and "could not ask" are
 * not the same answer:
 *
 *   0  applied, or already matching
 *   1  the management API refused the change
 *   2  could not measure — no credentials, no linked project, or the API unreachable
 *
 * Credentials come from the environment and the password is never printed:
 *
 *   PASHKI_SMTP_HOST          e.g. smtp.resend.com
 *   PASHKI_SMTP_PORT          465 for implicit TLS, 587 for STARTTLS
 *   PASHKI_SMTP_USER          provider's SMTP username
 *   PASHKI_SMTP_PASS          provider's SMTP password or API key
 *   PASHKI_SMTP_SENDER_EMAIL  the From address — must be on a domain the provider has verified
 *   PASHKI_SMTP_SENDER_NAME   what a person sees in their inbox; defaults to "Pashki"
 *   PASHKI_EMAIL_RATE_LIMIT   emails per hour to allow; defaults to 100
 *   SUPABASE_ACCESS_TOKEN     management API token
 *
 * Run it, then prove it worked with a real signup — a green run here means the settings were
 * accepted, not that mail arrives. Deliverability is DNS, and DNS is the provider's dashboard.
 *
 *   set -a && . ~/.pashki-supabase.env && set +a
 *   pnpm --filter @pashki/db set:smtp --dry-run
 *   pnpm --filter @pashki/db set:smtp
 */
import { execFileSync } from "node:child_process";

const APPLIED = 0;
const REFUSED = 1;
const CANNOT_MEASURE = 2;

const dryRun = process.argv.includes("--dry-run");

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

/**
 * What the caller supplied, checked before anything is sent.
 *
 * A missing variable is could-not-measure, not a partial apply: half a mail configuration is
 * worse than none, because auth would accept it and then fail at send time with the settings
 * looking populated.
 */
function desiredSettings() {
  const required = {
    smtp_host: process.env.PASHKI_SMTP_HOST,
    smtp_port: process.env.PASHKI_SMTP_PORT,
    smtp_user: process.env.PASHKI_SMTP_USER,
    smtp_pass: process.env.PASHKI_SMTP_PASS,
    smtp_admin_email: process.env.PASHKI_SMTP_SENDER_EMAIL,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) return { ok: false, missing };

  const port = Number(required.smtp_port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, invalid: `PASHKI_SMTP_PORT is not a port: ${required.smtp_port}` };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(required.smtp_admin_email)) {
    return { ok: false, invalid: `PASHKI_SMTP_SENDER_EMAIL is not an address: ${required.smtp_admin_email}` };
  }

  const rateLimit = Number(process.env.PASHKI_EMAIL_RATE_LIMIT ?? 100);
  if (!Number.isInteger(rateLimit) || rateLimit <= 0) {
    return { ok: false, invalid: `PASHKI_EMAIL_RATE_LIMIT is not a count: ${process.env.PASHKI_EMAIL_RATE_LIMIT}` };
  }

  return {
    ok: true,
    settings: {
      ...required,
      smtp_port: String(port),
      smtp_sender_name: process.env.PASHKI_SMTP_SENDER_NAME ?? "Pashki",
      /*
       * The 2/hour ceiling is what the absence of SMTP imposes; raising it is the point of
       * configuring one. Left deliberately modest — a rate limit is also the blast radius of a
       * signup loop, and it is easier to raise later than to explain a provider suspension.
       */
      rate_limit_email_sent: rateLimit,
    },
  };
}

async function readHosted(ref, token) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { ok: false, detail: `the management API answered ${response.status}` };
  return { ok: true, config: await response.json() };
}

/** Never print a password, and never print the shape of one either. */
const show = (key, value) =>
  key === "smtp_pass" ? (value ? "(set)" : "(not set)") : value === null || value === undefined || value === "" ? "(not set)" : String(value);

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("COULD NOT MEASURE: SUPABASE_ACCESS_TOKEN is not set.");
  console.error("  set -a && . ~/.pashki-supabase.env && set +a");
  console.error("  Nothing was changed, which is not the same as nothing needing to change.");
  process.exit(CANNOT_MEASURE);
}

const ref = linkedProjectRef();
if (!ref) {
  console.error("COULD NOT MEASURE: no linked project.");
  console.error("  Run from packages/db — the CLI takes its project id from the working directory.");
  process.exit(CANNOT_MEASURE);
}

const desired = desiredSettings();
if (!desired.ok) {
  console.error("COULD NOT MEASURE: the mail configuration is incomplete.");
  if (desired.missing) {
    console.error(`  not set: ${desired.missing.map((key) => "PASHKI_" + key.replace("smtp_admin_email", "smtp_sender_email").toUpperCase()).join(", ")}`);
    console.error("  Half a mail configuration is worse than none: auth accepts it and fails at send time.");
  }
  if (desired.invalid) console.error(`  ${desired.invalid}`);
  process.exit(CANNOT_MEASURE);
}

const before = await readHosted(ref, token);
if (!before.ok) {
  console.error(`COULD NOT MEASURE: ${before.detail}`);
  process.exit(CANNOT_MEASURE);
}

const changes = Object.entries(desired.settings).filter(([key, value]) => {
  // the API returns the password masked or omitted, so it can never be compared — always sent
  if (key === "smtp_pass") return true;
  return String(before.config[key] ?? "") !== String(value);
});

console.log(`project ${ref}`);
for (const [key, value] of Object.entries(desired.settings)) {
  const was = show(key, before.config[key]);
  const now = show(key, value);
  const mark = changes.some(([changed]) => changed === key) ? " *" : "  ";
  console.log(`${mark} ${key.padEnd(22)} ${was === now ? now : `${was}  ->  ${now}`}`);
}

if (dryRun) {
  console.log("\nDRY RUN: nothing was sent.");
  process.exit(APPLIED);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(desired.settings),
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  const detail = await response.text().catch(() => "");
  console.error(`\nREFUSED: the management API answered ${response.status}`);
  // the body can echo settings back; the password is not among them, but slice defensively
  if (detail) console.error(`  ${detail.slice(0, 300).replace(desired.settings.smtp_pass, "(redacted)")}`);
  process.exit(REFUSED);
}

/*
 * Read back rather than trusting the 200.
 *
 * A PATCH that returns success having ignored a field is exactly the silence-reads-as-success
 * failure this repo keeps meeting. The password cannot be verified this way — the API does not
 * return it — so it is reported as present, not as correct.
 */
const after = await readHosted(ref, token);
if (!after.ok) {
  console.error(`\nAPPLIED, BUT UNVERIFIED: ${after.detail}`);
  process.exit(REFUSED);
}

const wrong = Object.entries(desired.settings).filter(
  ([key, value]) => key !== "smtp_pass" && String(after.config[key] ?? "") !== String(value),
);

if (wrong.length > 0) {
  console.error("\nREFUSED: the API accepted the request and did not apply everything.");
  for (const [key, value] of wrong) {
    console.error(`  ${key}: asked for ${show(key, value)}, still ${show(key, after.config[key])}`);
  }
  process.exit(REFUSED);
}

console.log("\nAPPLIED: hosted auth now sends through its own provider.");
console.log("  A green run means the settings were accepted, not that mail arrives.");
console.log("  Prove it: register a new address and confirm the link lands. Deliverability is DNS.");
process.exit(APPLIED);
