#!/usr/bin/env node
/**
 * A pending flag that gates an interaction must be cleared in a `finally`.
 *
 * The shopping list lost its entire page to one dropped tap. `call()` set `busy`, awaited
 * `fetch`, and cleared `busy` afterwards — but an offline `fetch` **rejects**, so the clear never
 * ran, and every checkbox, "Have it" and pantry chip is `disabled={busy !== null}`. In a
 * supermarket dead spot the list went dead in somebody's hand, silently, and the crossings-off
 * already made were fiction. CLAUDE.md requires the app to work with no signal; it could not
 * survive one bad tap.
 *
 * Sweeping for it found **eleven** components with the same shape, two of them written the same
 * day the first was fixed. A defect that reappears while you are fixing it is not a defect, it is
 * a missing mechanism — so this is the mechanism.
 *
 * **The rule:** if a client component gates a control on a flag (`disabled={...busy...}`), every
 * async function that sets that flag must clear it in a `finally` — or hand the reset to
 * `useTransition`, which React unwinds itself.
 *
 * Deliberately shallow. It does not parse; it asks whether a file that gates on a flag and awaits
 * something also contains a `finally` that resets it. A file can fool it, but not by accident, and
 * the failure it prevents is an accident every time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/web";
const FLAGS = ["busy", "pending", "saving", "working", "sending", "submitting"];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

const unguarded = [];

for (const path of walk(ROOT)) {
  const source = readFileSync(path, "utf8");
  if (!source.includes('"use client"')) continue;

  // which flags actually gate a control on this screen
  const gated = FLAGS.filter((flag) =>
    new RegExp(String.raw`disabled=\{[^}]*\b${flag}\b`).test(source),
  );
  if (gated.length === 0) continue;

  // does it await anything that can reject?
  if (!/await\s+(fetch|browserClient|supabase|\w+\.(from|auth))/.test(source)) continue;

  for (const flag of gated) {
    const setter = `set${flag[0].toUpperCase()}${flag.slice(1)}`;
    if (!source.includes(`${setter}(`)) continue;

    // a reset inside a finally, or the flag is React's own transition state
    const resetsInFinally = new RegExp(
      String.raw`finally\s*\{[^}]*${setter}\(`,
      "s",
    ).test(source);
    const isTransition = new RegExp(String.raw`\[\s*${flag}\s*,\s*start`).test(source);
    if (!resetsInFinally && !isTransition) unguarded.push({ path, flag });
  }
}

if (unguarded.length > 0) {
  console.error("a pending flag gates a control and is not cleared in a finally:");
  for (const { path, flag } of unguarded) console.error(`  ${path}  (${flag})`);
  console.error("\nAn offline fetch rejects, so a reset after the await never runs and every");
  console.error("control gated on the flag stays dead. Clear it in a `finally`, or let");
  console.error("useTransition own it. The shopping list lost its whole page to this.");
  process.exit(1);
}

console.log("every pending flag that gates a control is cleared in a finally (apps/web).");
