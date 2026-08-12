/**
 * Shared plumbing for the repo's boundary guards.
 *
 * Both guards ask the same question — "does any file outside these paths mention
 * this thing?" — so the walking and comment-stripping live here rather than being
 * copied and drifting apart.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "build",
  ".next",
  ".expo",
  "coverage",
]);

/** Every source file in the repo, as `{ path, source }` with repo-relative paths. */
export function sourceFiles(root) {
  const found = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!CODE.test(entry)) continue;
      found.push({ path: relative(root, full), source: readFileSync(full, "utf8") });
    }
  };

  walk(root);
  return found;
}

/**
 * Remove block and line comments, so prose about a boundary does not count as
 * crossing it. Deliberately naive: it will also blank a `//` inside a string
 * literal, which for these guards errs toward a false negative in a comment rather
 * than a false alarm in code.
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Test files are allowed to reach past boundaries; that is what makes them tests. */
export function isTestFile(path) {
  return /(^|\/)test(s)?\//.test(path) || /\.(test|spec)\.[a-z]+$/.test(path);
}

/** 1-indexed line of the first match, for a clickable error. */
export function lineOf(source, pattern) {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return 1;
}
