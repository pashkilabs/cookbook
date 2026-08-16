#!/usr/bin/env node
/**
 * No native module at module scope in the web app.
 *
 * The trap this makes mechanical: `sharp` is a native addon, and a static import pulls it into
 * every serverless function that touches the file. It has now cost two outages. The first was
 * five routes returning 500 from the day they shipped, because one route wanted a bucket *name*
 * from a module that imported an image library. The second was mine, in the same file, hours
 * after re-reading the note about the first.
 *
 * A written trap did not prevent either. This is the same reasoning as the platform-table and
 * server-only guards, which do work: a rule a build enforces is a rule, and a rule in a document
 * is a hope.
 *
 * `await import("...")` inside a function is fine and is the fix — the cost is paid only by the
 * path that needs it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCANNED = ["apps/web"];

/** Packages that carry a `.node` binary, directly or by re-export. */
const NATIVE = [/(^|["'/])sharp(["'/]|$)/, /@img\//, /better-sqlite3/, /\bcanvas\b/, /\bbcrypt\b/];

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) files.push(full);
  }
};
for (const dir of SCANNED) walk(join(ROOT, dir));

const problems = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    // a static import only: `await import(...)` and `require()` inside a function are the fix
    const isStatic = /^\s*import\s[^(]/.test(line) || /^\s*export\s+.*\sfrom\s/.test(line);
    if (!isStatic) continue;
    if (NATIVE.some((re) => re.test(line))) {
      problems.push(`  ${relative(ROOT, file)}:${index + 1}  ${line.trim().slice(0, 78)}`);
    }
  }
}

if (problems.length > 0) {
  console.error("native modules imported at module scope:\n");
  console.error(problems.join("\n"));
  console.error(`
A native addon cannot be bundled, so it is pulled into every serverless function
that touches the file — including routes that never use it. That is how five
routes returned 500 from the day they shipped.

Load it inside the function that needs it:

    const { createSharpImagePreparer } = await import("@pashki/import/sharp");
`);
  process.exit(1);
}
console.log(`no native module is imported at module scope (${files.length} files).`);
