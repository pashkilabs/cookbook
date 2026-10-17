#!/usr/bin/env node
/**
 * How far is this working tree from what is deployed?
 *
 * ---------------------------------------------------------------------------
 * Why this is not `check-migrations-pushed`, and not inside `pnpm check`
 * ---------------------------------------------------------------------------
 *
 * `pnpm ship` asks whether the *database* is ready for a push, and is deliberately outside
 * `pnpm check` because during normal work a migration exists locally first — a check that refused
 * every mid-feature tree would fail routinely, and a check that fails routinely is one people
 * learn to ignore. That reasoning is still right.
 *
 * What it left behind is that **nothing asked the question at all.** Ten commits of restyle work
 * were verified green against `127.0.0.1:3000` and reported as done, while production served the
 * previous palette. Both statements were true; one of them was never about the deployment. The
 * loop had no step that could have noticed, because every tool in it — `pnpm check`, the guards,
 * `smoke:local` — is correct about the repository and silent about the deployment.
 *
 * So this **never fails**. It is not a gate; it is the sentence that has to appear next to the
 * word "green". Exit 0 whatever it finds, so it can sit in `pnpm check` without becoming the
 * routine failure that argument was about — and print loudly enough that writing "verified" under
 * `AHEAD OF DEPLOYED BY 10 COMMITS` is an obvious contradiction rather than an invisible one.
 *
 * It answers out of the deployment's own mouth: `/api/health` reports the commit it was built
 * from. No git remote state, no CI API, no token — just the thing that is actually running.
 */
import { execSync } from "node:child_process";

const SITE = process.env.PASHKI_SITE_URL ?? "https://cookbook.pashki.com";
const git = (command) => execSync(command, { encoding: "utf8" }).trim();

const head = git("git rev-parse HEAD");
const shortHead = head.slice(0, 7);
const dirty = git("git status --porcelain").length > 0;

let deployed = null;
let why = null;
try {
  const response = await fetch(`${SITE}/api/health`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) why = `HTTP ${response.status}`;
  else {
    const health = await response.json();
    deployed = typeof health.commit === "string" ? health.commit : null;
    if (!deployed) why = "no commit in /api/health";
  }
} catch (error) {
  why = error.name === "TimeoutError" ? "timed out" : String(error.message).slice(0, 60);
}

const say = (line) => console.log(`  ${line}`);
console.log("");

if (deployed === null) {
  /*
   * Could-not-measure, said as could-not-measure. Offline is the common case and must not read as
   * "nothing to report" — the whole failure this file exists for is a silence that looked like a
   * pass.
   */
  say(`DEPLOYMENT UNKNOWN — could not read ${SITE}/api/health (${why})`);
  say(`local HEAD ${shortHead}${dirty ? " (dirty)" : ""}; nothing here has been compared to production.`);
  say(`Any "verified" below is about this machine.`);
  console.log("");
  process.exit(0);
}

if (deployed === head && !dirty) {
  say(`IN SYNC — ${SITE} is running ${shortHead}, which is this tree.`);
  console.log("");
  process.exit(0);
}

let ahead = null;
try {
  ahead = Number(git(`git rev-list ${deployed}..HEAD --count`));
} catch {
  // the deployed commit is not an object here — a different branch, or a shallow clone
}

if (ahead === null) {
  say(`NOT COMPARABLE — ${SITE} is running ${deployed.slice(0, 7)}, which this clone does not have.`);
} else if (ahead === 0) {
  say(`AHEAD OF DEPLOYED BY 0 COMMITS, but the tree is dirty — ${shortHead} + uncommitted changes.`);
} else {
  say(`AHEAD OF DEPLOYED BY ${ahead} COMMIT${ahead === 1 ? "" : "S"}${dirty ? " + uncommitted changes" : ""}`);
  say(`${SITE} is running ${deployed.slice(0, 7)}; this tree is ${shortHead}.`);
  console.log("");
  for (const line of git(`git log --oneline ${deployed}..HEAD`).split("\n").slice(0, 10)) {
    say(`  not deployed: ${line}`);
  }
}
console.log("");
say(`Nothing above is in front of anybody yet. Say WHICH HOST when reporting a verification,`);
say(`and run \`pnpm ship\` to deploy. A verification without a host is a verification of nothing`);
say(`in particular.`);
console.log("");
process.exit(0);
