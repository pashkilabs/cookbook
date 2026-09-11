#!/usr/bin/env node
/**
 * A fixture whose input is corrupt measures the wrong thing.
 *
 * `instagram-texas-twinkies.txt` carries 28 U+FFFD REPLACEMENT CHARACTERs where emoji should be —
 * destroyed when the caption was transcribed, not by the reader, which decodes the file correctly
 * and faithfully reproduces the damage. Extraction returns nothing from it, so it dropped out of
 * an eighteen-fixture run and the score read 17/18 with nobody the wiser.
 *
 * That is this project's oldest failure wearing another suit: a check that cannot distinguish
 * "no result" from "passed". So this fails loudly, and names the file and the count.
 *
 * ---------------------------------------------------------------------------
 * Two copies, and for a while this guarded the wrong one
 * ---------------------------------------------------------------------------
 *
 * A caption exists twice: as text under `intake/captions` for a person to read against the
 * original post, and inline in `eval/fixtures/*.ts`, which is **the copy the eval actually
 * runs**. This checked only the first. So when the .txt was re-transcribed the guard went green
 * while the eval went on reading a damaged string and reporting a damaged score — the fix
 * verified against the copy nobody executes.
 *
 * Same shape as a route with two doors, and as `section` surviving the import path while the
 * edit screen erased it. Both are scanned now.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["packages/core/eval/intake/captions", "packages/core/eval/fixtures"];
const damaged = [];

for (const root of ROOTS) {
  for (const name of readdirSync(root)) {
    // the transcriptions a person reads, and the fixtures the eval runs
    if (!name.endsWith(".txt") && !name.endsWith(".ts")) continue;
    const text = readFileSync(join(root, name), "utf8");
    const count = [...text].filter((ch) => ch === "�").length;
    if (count > 0) damaged.push({ name: join(root, name), count });
  }
}

if (damaged.length > 0) {
  console.error("fixture text is damaged — U+FFFD where a character should be:");
  for (const { name, count } of damaged) console.error(`  ${name}: ${count}`);
  console.error("\nRe-transcribe from the original post. A corrupt fixture scores as a missing");
  console.error("result rather than a failure, which is how 17 of 18 read as a full run.");
  process.exit(1);
}

console.log(`fixture text is intact (${ROOTS.join(", ")}).`);
