#!/usr/bin/env node
/**
 * When a write fails because there is no signal, does the person find out?
 *
 * ---------------------------------------------------------------------------
 * The half of the shopping-list lesson nobody closed
 * ---------------------------------------------------------------------------
 *
 * `check-busy-guarded.mjs` asks whether a pending flag is cleared in a `finally`, because an
 * offline `fetch` **rejects** and a reset placed after the await never runs — one bad tap in
 * aisle four left every control on the shopping list dead in somebody's hand.
 *
 * That guard was built, and it only ever asked about the flag. The same rejection has a second
 * consequence and nothing asked about it: with a `try`/`finally` and **no `catch`**, the promise
 * rejects unhandled and the screen says *nothing at all*. The control comes back enabled, the
 * work was not saved, and there is no message — which is worse than the dead screen, because a
 * dead screen is at least visibly wrong.
 *
 * Found at **9 of 29** try-blocks when first run, including sign-in (no message, offline) and the
 * recipe form (a recipe you typed, silently not saved). `CLAUDE.md` says this app must work with
 * no signal; nine client paths disagreed silently.
 *
 * The rule: **a `try` that awaits `fetch` has a `catch`.** Narrow on purpose — every fetch in a
 * client component here is user-initiated, and there is no case where silence is the right answer
 * to one failing. A `catch` that re-throws or logs would satisfy this and is not the point; the
 * point is that the screen gets a chance to speak.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/web";
const SKIP = new Set([".next", "node_modules", "test"]);

if (!existsSync(ROOT)) {
  console.error(`COULD NOT MEASURE: ${ROOT} is not there — a renamed directory must not read as a pass`);
  process.exit(2);
}

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.tsx?$/.test(path)) files.push(path);
  }
};
walk(ROOT);

/** the matching close brace for the `{` at `open` */
function blockEnd(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const problems = [];
let examined = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  // client files only: a server component's fetch failure is a 500 and Next's error page says so
  if (!source.includes('"use client"')) continue;

  for (const match of source.matchAll(/\btry\s*\{/g)) {
    const open = source.indexOf("{", match.index);
    const close = blockEnd(source, open);
    if (close === -1) continue;
    if (!source.slice(open, close + 1).includes("await fetch(")) continue;
    examined += 1;
    if (!/^\s*catch/.test(source.slice(close + 1, close + 40))) {
      problems.push(`${file}:${source.slice(0, match.index).split("\n").length}`);
    }
  }
}

if (examined === 0) {
  /*
   * Zero is not a pass. If no client file awaits a fetch, either the app changed shape or this
   * check stopped finding what it looks for — and "nothing to report" has read as success in this
   * project often enough to be its own rule.
   */
  console.error("COULD NOT MEASURE: found no client-side `try` awaiting a fetch at all.");
  console.error("Either the app no longer writes from the browser, or this check is looking wrong.");
  process.exit(2);
}

if (problems.length > 0) {
  console.error(`${problems.length} of ${examined} client try-blocks await a fetch with no catch:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\nAn offline fetch REJECTS. With no catch the promise rejects unhandled, the screen`);
  console.error(`says nothing, and the work was not saved. Say so — "No signal — that was not saved".`);
  process.exit(1);
}
console.log(`all ${examined} client try-blocks that await a fetch can say so when there is no signal.`);
