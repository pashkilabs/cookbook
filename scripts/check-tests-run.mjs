#!/usr/bin/env node
/**
 * Every test file is matched by a vitest config, or the build fails.
 *
 * A `.tsx` test sat outside an `include: ["test/**\/*.test.ts"]` pattern and the suite reported
 * the same count as before it existed: seven tests, never executed, counted as passing. That is
 * "silence reads as success" arriving through a config rather than a harness — and a check that
 * does not run is worse than no check, because it is believed.
 *
 * Deliberately not a glob engine. It compares the two things that actually go wrong — the folder
 * a test sits in and the extension it was given — because a wrong glob matcher would be a second
 * thing to get right, and the first attempt at one reported all fifty files as orphaned.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".next", "dist", ".git", ".turbo"]);

function walk(dir, hit) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, hit);
    else hit(full);
  }
}

const configs = [];
walk(ROOT, (file) => {
  if (!/vitest\.config\.[cm]?[jt]s$/.test(file)) return;
  const source = readFileSync(file, "utf8");
  const include = /include:\s*\[([^\]]*)\]/.exec(source);
  const globs = include
    ? [...include[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1])
    : ["**/*.test.ts", "**/*.test.tsx", "**/*.test.js"];

  const roots = new Set();
  const exts = new Set();
  for (const glob of globs) {
    roots.add(glob.split("/")[0].includes("*") ? "" : glob.split("/")[0]);
    const braced = /\{([^}]+)\}\s*$/.exec(glob);
    if (braced) for (const ext of braced[1].split(",")) exts.add("." + ext.trim());
    else exts.add(extname(glob));
  }
  configs.push({ dir: dirname(file), roots, exts });
});

const orphans = [];
walk(ROOT, (file) => {
  if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return;
  const covered = configs.some(({ dir, roots, exts }) => {
    if (!file.startsWith(dir + "/")) return false;
    const rel = relative(dir, file);
    const top = rel.split("/")[0];
    return (roots.has("") || roots.has(top)) && exts.has(extname(rel));
  });
  if (!covered) orphans.push(relative(ROOT, file));
});

if (orphans.length > 0) {
  console.error("test files no vitest config will run:\n");
  for (const file of orphans) console.error("  " + file);
  console.error(
    "\nA test that does not run is worse than no test: it is counted. Widen the include\n" +
      "pattern of the nearest vitest.config, or move the file under one that matches it.\n",
  );
  process.exit(1);
}
console.log(`every test file is matched by a vitest config (${configs.length} configs).`);
