/**
 * Auth settings, compared between the two environments.
 *
 * The database half of the parity check compares schema and privileges. This half exists
 * because the second asymmetry to bite was not in the schema at all: local shipped
 * `enable_confirmations = false` while hosted requires confirmation, so every negative test
 * about unconfirmed accounts passed for the wrong reason. Neither environment is reliably
 * stricter than the other — they simply differ, and a setting that differs makes local a bad
 * proxy for production in one direction or the other.
 *
 * **Local is read from the running GoTrue container's environment, not from `config.toml`.**
 * The container holds what is actually in effect; the file holds what somebody wrote, and the
 * CLI translates between them (`enable_confirmations` becomes `GOTRUE_MAILER_AUTOCONFIRM`,
 * inverted). Comparing the file would compare intentions.
 *
 * Some settings are *expected* to differ, and pretending otherwise would make this noisy
 * enough to ignore — which is the same failure as reporting nothing. Those are listed with a
 * reason and marked, not counted. Everything else differing is a finding.
 */
import { execFileSync } from "node:child_process";

/**
 * hosted key → { local: GoTrue env var, expectedToDiffer?: why }
 *
 * Only settings readable from both sides. Secrets are compared as present/absent rather than
 * by value — the check is whether one environment has a thing configured and the other does
 * not, and printing a key would be worse than useless.
 */
const SETTINGS = {
  mailer_autoconfirm: { local: "GOTRUE_MAILER_AUTOCONFIRM" },
  external_email_enabled: { local: "GOTRUE_EXTERNAL_EMAIL_ENABLED" },
  disable_signup: { local: "GOTRUE_DISABLE_SIGNUP" },
  mailer_secure_email_change_enabled: { local: "GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED" },
  mailer_otp_exp: { local: "GOTRUE_MAILER_OTP_EXP" },
  mailer_otp_length: { local: "GOTRUE_MAILER_OTP_LENGTH" },
  password_min_length: { local: "GOTRUE_PASSWORD_MIN_LENGTH" },
  password_required_characters: { local: "GOTRUE_PASSWORD_REQUIRED_CHARACTERS" },
  security_captcha_enabled: { local: "GOTRUE_SECURITY_CAPTCHA_ENABLED" },
  security_captcha_provider: {
    local: "GOTRUE_SECURITY_CAPTCHA_PROVIDER",
    expectedToDiffer:
      "hosted records a default provider while captcha is disabled; security_captcha_enabled is what changes behaviour and is compared above",
  },
  jwt_exp: { local: "GOTRUE_JWT_EXP" },
  refresh_token_rotation_enabled: { local: "GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED" },
  security_refresh_token_reuse_interval: { local: "GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL" },
  rate_limit_token_refresh: { local: "GOTRUE_RATE_LIMIT_TOKEN_REFRESH" },
  rate_limit_verify: { local: "GOTRUE_RATE_LIMIT_VERIFY" },
  rate_limit_otp: { local: "GOTRUE_RATE_LIMIT_OTP" },
  rate_limit_anonymous_users: { local: "GOTRUE_RATE_LIMIT_ANONYMOUS_USERS" },
  rate_limit_sms_sent: { local: "GOTRUE_RATE_LIMIT_SMS_SENT" },

  site_url: {
    local: "GOTRUE_SITE_URL",
    expectedToDiffer: "different hosts by nature — localhost against a deployed domain",
  },
  uri_allow_list: {
    local: "GOTRUE_URI_ALLOW_LIST",
    expectedToDiffer: "follows site_url; both must carry the path glob, which is what to eyeball",
  },
  rate_limit_email_sent: {
    local: "GOTRUE_RATE_LIMIT_EMAIL_SENT",
    expectedToDiffer: (_local, hosted) =>
      Number(hosted) <= 2
        ? "local sends freely so the confirmation flow is testable; hosted's 2/hour is the ceiling imposed by having no SMTP provider, and the blocker for public signup"
        : "local sends freely so the confirmation flow is testable; hosted's limit is what its provider and its appetite for a signup loop allow",
  },
  smtp_host: {
    local: "GOTRUE_SMTP_HOST",
    /*
     * Two very different states wear the same "differs" badge here, so the reason is computed
     * rather than written down once. Baking "hosted has none configured" into a string would
     * have kept printing it after one was configured — a parity check quietly asserting a stale
     * fact is worse than one that says nothing.
     */
    expectedToDiffer: (_local, hosted) =>
      hosted === "(not set)"
        ? "local captures mail in Mailpit; HOSTED HAS NO PROVIDER, so it sends 2 emails an hour through a shared address — run pnpm --filter @pashki/db set:smtp"
        : "local captures mail in Mailpit; hosted sends through its own provider",
  },
  smtp_admin_email: {
    local: "GOTRUE_SMTP_ADMIN_EMAIL",
    expectedToDiffer: "follows smtp_host",
  },
  smtp_sender_name: {
    local: "GOTRUE_SMTP_SENDER_NAME",
    expectedToDiffer: "follows smtp_host",
  },
  smtp_max_frequency: {
    local: "GOTRUE_SMTP_MAX_FREQUENCY",
    expectedToDiffer: "local shortens the gap between sends so a resend is testable",
  },
};

/** Settings held as secrets: compared as configured/absent, never by value. */
const SECRET_SETTINGS = new Set(["smtp_pass", "security_captcha_secret"]);

export async function compareAuthSettings({ projectRef, accessToken }) {
  const local = readLocalGoTrue();
  if (!local.ok) return { ok: false, detail: local.detail };

  const hosted = await readHostedConfig({ projectRef, accessToken });
  if (!hosted.ok) return { ok: false, detail: hosted.detail };

  const rows = [];
  for (const [key, spec] of Object.entries(SETTINGS)) {
    const mine = normalise(local.env[spec.local]);
    const theirs = normalise(hosted.config[key]);
    if (mine === "(not set)" && theirs === "(not set)") continue;
    rows.push({
      key,
      local: mine,
      hosted: theirs,
      differs: mine !== theirs,
      expectedToDiffer:
        typeof spec.expectedToDiffer === "function"
          ? spec.expectedToDiffer(mine, theirs)
          : spec.expectedToDiffer,
    });
  }

  for (const key of SECRET_SETTINGS) {
    const theirs = hosted.config[key];
    rows.push({
      key: `${key} (configured?)`,
      local: "n/a",
      hosted: theirs ? "configured" : "absent",
      differs: false,
      expectedToDiffer: "compared as presence only; a secret's value is never printed",
    });
  }

  return { ok: true, rows };
}

function readLocalGoTrue() {
  let name;
  try {
    name = execFileSync("docker", ["ps", "--filter", "name=supabase_auth_", "--format", "{{.Names}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    })
      .trim()
      .split("\n")[0];
  } catch {
    return { ok: false, detail: "docker is not answering, so the local auth container cannot be read" };
  }
  if (!name) return { ok: false, detail: "no local GoTrue container is running" };

  let raw;
  try {
    raw = execFileSync("docker", ["inspect", name, "--format", "{{range .Config.Env}}{{println .}}{{end}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    });
  } catch (error) {
    return { ok: false, detail: `docker inspect ${name} failed: ${error.status ?? "?"}` };
  }

  const env = {};
  for (const line of raw.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return { ok: true, env };
}

async function readHostedConfig({ projectRef, accessToken }) {
  if (!accessToken) {
    return {
      ok: false,
      detail: "SUPABASE_ACCESS_TOKEN is not set, so hosted auth settings cannot be read",
    };
  }
  if (!projectRef) {
    return { ok: false, detail: "no linked project ref, so hosted auth settings cannot be read" };
  }

  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { ok: false, detail: `the management API did not answer: ${error.message}` };
  }
  if (!response.ok) {
    return { ok: false, detail: `the management API answered ${response.status}` };
  }
  return { ok: true, config: await response.json() };
}

/**
 * Everything to a comparable string.
 *
 * An empty string and an absent key both mean "not set" — GoTrue writes the first, the
 * management API omits the second — so they compare equal. Distinguishing them was noise on
 * every run, and noise reads as fine in exactly the way silence reads as success.
 */
function normalise(value) {
  if (value === undefined || value === null || value === "") return "(not set)";
  return String(value);
}
