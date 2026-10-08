#!/usr/bin/env node
/**
 * Which source files are covered by **no** tsconfig?
 *
 * The question nothing had ever asked. `pnpm typecheck` runs five projects and reports success,
 * and success means "every file I was told about is fine" — it cannot mention a file it was
 * never told about. So a file outside every `include` compiles as nothing and reports nothing,
 * and `pnpm check` goes green over it.
 *
 * Sixteen files were in that state, and the list is the argument: **`eval.mts`**, which produces
 * the accuracy numbers model choices are made from; **`generate-seed.ts`**, which writes
 * `seed.sql`; and every measurement script — `ripeness`, `ab-consensus`, `gate-curve`,
 * `measure-components`. A script that compiles as nothing can report confidently from broken
 * code, and two of them did: `eval.mts` was calling `createImportExtractor` with options that do
 * not satisfy its own type, and `pull-corpus.mts` read `.length` off an `unknown`.
 *
 * The same shape as every other guard here. `check-tests-run.mjs` asks which test files no
 * vitest config will run; this asks which source files no tsconfig will check. Both exist
 * because a tool reporting on what it was given cannot report on what it was not.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(".");
const PROJECTS = ["apps/web", "packages/core", "packages/db", "packages/import", "packages/platform-client"];

/*
 * Not ours and not checkable: dependency trees, build output, and Supabase's own scratch
 * directory, which holds a generated edge-runtime entry point that appears and vanishes with
 * `db:start`. Excluding it by name rather than by pattern, so a real directory cannot hide here.
 */
const SKIP = ["node_modules", ".next", ".turbo", "dist", ".git"];
const SKIP_PATHS = ["packages/db/supabase/.temp"];

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const relative = path.slice(ROOT.length + 1);
    if (SKIP.includes(name) || SKIP_PATHS.some((p) => relative.startsWith(p))) continue;
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const covered = new Set();
for (const project of PROJECTS) {
  let listed = "";
  try {
    listed = execFileSync("npx", ["tsc", "-p", "tsconfig.json", "--noEmit", "--listFiles"], {
      cwd: join(ROOT, project),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (thrown) {
    // a project that fails to compile still lists what it read, and that is what is wanted here
    listed = String(thrown.stdout ?? "");
    if (!listed) {
      console.error(`could not list files for ${project} — this check cannot run, which is not a pass`);
      process.exit(2);
    }
  }
  for (const line of listed.split("\n")) {
    const file = line.trim();
    if (file && !file.includes("/node_modules/")) covered.add(resolve(file));
  }
}

const uncovered = sources(ROOT).filter((path) => !covered.has(resolve(path)));

if (uncovered.length > 0) {
  console.error("source files no tsconfig checks:");
  for (const path of uncovered) console.error(`  ${path.slice(ROOT.length + 1)}`);
  console.error("\nA file outside every `include` compiles as nothing and reports nothing, so");
  console.error("`pnpm typecheck` passes over it. Add it to the nearest tsconfig's `include`.");
  process.exit(1);
}

console.log(`every source file is checked by a tsconfig (${PROJECTS.length} projects).`);
