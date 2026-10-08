/**
 * Replace SUPABASE_ACCESS_TOKEN in the credentials file — verified before it is written.
 *
 * ---------------------------------------------------------------------------
 * Why this is a command and not a note
 * ---------------------------------------------------------------------------
 *
 * A management token expires, `check:parity` starts exiting 2 on its auth half, and the auth
 * half is the only thing that compares auth settings between local and hosted. That half has
 * already caught the divergence that makes *local the more permissive* of the two environments
 * (hosted `mailer_autoconfirm: false` against the CLI's `enable_confirmations = false`), which
 * every negative test about unconfirmed accounts passes vacuously without. So a rotation is an
 * operation this project performs repeatedly, and an operation performed repeatedly from memory
 * is one that gets performed wrongly.
 *
 * ---------------------------------------------------------------------------
 * Verify first, write second
 * ---------------------------------------------------------------------------
 *
 * The token is checked against `GET /v1/projects/<ref>/config/auth` **before** the file is
 * touched. A file is the only copy of this credential, and the failure to design out is a
 * mistyped token replacing an expired one and surfacing a week later as the same exit 2 — a
 * rotation that looks done and is not.
 *
 * `presence is not agreement` is the rule behind it: that a variable is set says nothing about
 * whether it is the right value, and this project has already shipped two secrets that were
 * present on both sides and different. So the check is the real endpoint with the real project
 * ref, which proves the token is valid *and* that it can reach this project — a token good for
 * a different account answers 403 or 404 rather than 200, and those are distinguished.
 *
 * Three outcomes with distinct exit codes, because a rotation that could not be checked must
 * not read like one that worked:
 *
 *   0  rotated — the new token answered 200, the file was rewritten, the read-back matched
 *   1  refused — the token was rejected, or the file could not be written. Nothing changed.
 *   2  could not measure — no ref, no network, no token supplied. Nothing changed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KEY = "SUPABASE_ACCESS_TOKEN";
const DEFAULT_FILE = path.join(os.homedir(), ".pashki-supabase.env");
const REF_FILE = path.join(import.meta.dirname, "..", "supabase", ".temp", "project-ref");

const argFile = process.argv.indexOf("--file");
const file = argFile > 0 ? process.argv[argFile + 1] : DEFAULT_FILE;

const cannotMeasure = (why) => {
  console.error(`COULD NOT MEASURE: ${why}`);
  console.error("Nothing was changed.");
  process.exit(2);
};
const refuse = (why) => {
  console.error(`REFUSED: ${why}`);
  console.error("Nothing was changed.");
  process.exit(1);
};

/** the linked project, so the check proves reachability of *this* project and not just validity */
function projectRef() {
  try {
    const ref = fs.readFileSync(REF_FILE, "utf8").trim();
    return ref || null;
  } catch {
    return null;
  }
}

/**
 * Hidden at a terminal, piped otherwise.
 *
 * Never an argument: an argument is visible in `ps` and lands in shell history. `stty -echo`
 * keeps it off the screen, and the pipe form exists so `pbpaste | … ` works without a prompt.
 */
function readToken() {
  if (!process.stdin.isTTY) {
    let piped = "";
    try {
      piped = fs.readFileSync(0, "utf8");
    } catch {
      return null;
    }
    const token = piped.trim();
    return token || null;
  }

  process.stderr.write(`Paste the new ${KEY} (not echoed): `);
  let echoOff = false;
  try {
    execFileSync("stty", ["-echo"], { stdio: ["inherit", "ignore", "ignore"] });
    echoOff = true;
  } catch {
    process.stderr.write("\n");
    return null;
  }
  try {
    const fd = fs.openSync("/dev/tty", "rs");
    const buffer = Buffer.alloc(1);
    let out = "";
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, 1, null);
      if (read === 0) break;
      const character = buffer.toString("utf8");
      if (character === "\n" || character === "\r") break;
      out += character;
    }
    fs.closeSync(fd);
    return out.trim() || null;
  } catch {
    return null;
  } finally {
    if (echoOff) {
      try {
        execFileSync("stty", ["echo"], { stdio: ["inherit", "ignore", "ignore"] });
      } catch {
        /* the shell will recover echo on the next prompt; not worth failing a rotation over */
      }
    }
    process.stderr.write("\n");
  }
}

/** enough of the token to compare two copies by eye, never enough to use */
const fingerprint = (token) => `${token.slice(0, 7)}…${token.slice(-4)} (${token.length} chars)`;

async function verify(token, ref) {
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { outcome: "unmeasurable", detail: `the management API did not answer: ${error.message}` };
  }
  if (response.status === 200) return { outcome: "ok" };
  if (response.status === 401) {
    return { outcome: "rejected", detail: "the management API answered 401 — this token is not valid" };
  }
  if (response.status === 403 || response.status === 404) {
    return {
      outcome: "rejected",
      detail:
        `the management API answered ${response.status} — the token is valid but cannot reach ` +
        `project ${ref}. Likely issued on a different Supabase account.`,
    };
  }
  // a 500 or a 429 says nothing about the token, and must not be read as a rejection
  return { outcome: "unmeasurable", detail: `the management API answered ${response.status}` };
}

const ref = projectRef();
if (!ref) cannotMeasure(`no linked project ref at ${REF_FILE} — run this from packages/db`);

let original;
try {
  original = fs.readFileSync(file, "utf8");
} catch (error) {
  cannotMeasure(`${file} could not be read: ${error.message}`);
}

const token = readToken();
if (!token) {
  cannotMeasure("no token supplied — paste one at the prompt, or pipe it in");
}
if (/\s/.test(token)) {
  refuse("the token contains whitespace, which a dotenv line cannot carry");
}

process.stderr.write(`Checking it against project ${ref} before writing…\n`);
const checked = await verify(token, ref);
if (checked.outcome === "unmeasurable") cannotMeasure(checked.detail);
if (checked.outcome === "rejected") refuse(checked.detail);

/*
 * Every occurrence, not the first.
 *
 * `set -a && . file` is last-wins, so replacing one of two assignments is a silent no-op — the
 * file looks updated and the shell keeps exporting the old value. The count is reported for the
 * same reason.
 */
const lines = original.split("\n");
const matcher = new RegExp(`^\\s*(export\\s+)?${KEY}\\s*=`);
let replaced = 0;
const rewritten = lines.map((line) => {
  if (!matcher.test(line)) return line;
  replaced += 1;
  const keepsExport = /^\s*export\s/.test(line);
  return `${keepsExport ? "export " : ""}${KEY}=${token}`;
});
if (replaced === 0) {
  // appended rather than refused: a missing key is a first-time setup, not an error
  if (rewritten.length > 0 && rewritten[rewritten.length - 1] === "") rewritten.pop();
  rewritten.push(`${KEY}=${token}`, "");
}

const backup = `${file}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
const temporary = `${file}.rotating`;
try {
  fs.writeFileSync(backup, original, { mode: 0o600 });
  fs.writeFileSync(temporary, rewritten.join("\n"), { mode: 0o600 });
  fs.renameSync(temporary, file); // rename, so no reader ever sees a half-written credentials file
  fs.chmodSync(file, 0o600);
} catch (error) {
  try {
    fs.rmSync(temporary, { force: true });
  } catch {
    /* nothing to clean up */
  }
  refuse(`${file} could not be written: ${error.message}`);
}

/* read back: a write that reported success and produced a different value is the whole point */
const readBack = fs.readFileSync(file, "utf8");
const found = readBack
  .split("\n")
  .filter((line) => matcher.test(line))
  .map((line) => line.slice(line.indexOf("=") + 1));
if (found.length === 0 || found.some((value) => value !== token)) {
  refuse(`the file was written but does not read back as the new token. Old file kept at ${backup}`);
}

console.log(`ROTATED: ${KEY} in ${file}`);
console.log(`  ${fingerprint(token)}, verified against project ${ref}`);
console.log(
  replaced === 0
    ? "  the key was absent and has been appended"
    : `  ${replaced} assignment${replaced === 1 ? "" : "s"} replaced`,
);
console.log(`  previous file kept at ${backup}`);

/*
 * Duplicate keys are worth saying out loud for the same last-wins reason: somebody editing the
 * first of two assignments changes nothing and has no way to tell.
 */
const counts = new Map();
for (const line of readBack.split("\n")) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
}
const duplicated = [...counts.entries()].filter(([, times]) => times > 1);
if (duplicated.length > 0) {
  console.log("");
  console.log("  NOTE: this file assigns some keys more than once. `set -a && .` is last-wins,");
  console.log("  so editing the earlier assignment of one of these changes nothing:");
  for (const [name, times] of duplicated) console.log(`    ${name} — ${times} times`);
}

console.log("");
console.log("Next: set -a && . ~/.pashki-supabase.env && set +a");
console.log("Then: pnpm --filter @pashki/db check:parity   (the auth half should stop exiting 2)");
