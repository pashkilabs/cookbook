/**
 * Is every colour a token? No hex literal outside `packages/design-tokens`.
 *
 * The handoff's rule, and the reason this codebase keeps relearning: two copies of a value agree
 * until somebody edits one of them. A hex in a component is a colour that will not follow the
 * theme, will not follow a palette revision, and will look right in whichever mode its author had
 * open.
 *
 * ---------------------------------------------------------------------------
 * What is allowed, and why each exemption exists rather than being convenient
 * ---------------------------------------------------------------------------
 *
 *   design-tokens/        the source of truth. Hex belongs here and nowhere else.
 *   tokens.generated.css  generated FROM it, and `check-tokens-css.mjs` proves it matches.
 *   tests                 a test asserting a colour has to name one.
 *   reference/            the handoff wireframes, if they are ever vendored in.
 *   member-colours.ts     the seam's **reference** values, and the one exemption that is a
 *                         decision rather than a convenience. Its own comment says it: "a
 *                         reference value for anything that cannot read the stylesheet; the app
 *                         owns the real one." The seam owns the *words* — `family_members.colour`
 *                         stores `"clay"` — precisely so appearance stays the app's business, and
 *                         making the seam import a design package would invert that and cost the
 *                         portability the key-storage exists for. Drift is prevented by
 *                         comparison instead: `packages/design-tokens/test/member-colours.test.ts`
 *                         fails if the two disagree.
 *
 * Three outcomes: a stray literal is 1, an unreadable tree is 2, clean is 0. A check that cannot
 * run must not look like one that passed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SEARCH = ["apps/web", "packages/core/src", "packages/db/src", "packages/import/src",
  "packages/platform-client/src"];
const SKIP = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);
const EXTENSIONS = /\.(ts|tsx|css|js|jsx|mjs)$/;

/*
 * #abc, #aabbcc, #aabbccdd — in a style string, a stylesheet, or a stray constant.
 *
 * The `(?<!&)` matters: `&#039;` is an apostrophe, and without it this reported two HTML entities
 * **inside comments** as stray colours. A guard that cries wolf is one nobody believes, and both
 * false positives were in prose explaining a different bug entirely.
 */
const HEX = /(?<!&)#[0-9a-fA-F]{3,8}\b/g;

const exempt = (file) =>
  file.includes("packages/design-tokens/") ||
  file.endsWith("tokens.generated.css") ||
  /\.test\.(ts|tsx)$/.test(file) ||
  file.includes("/test/") ||
  file.includes("/reference/") ||
  file.endsWith("platform-client/src/member-colours.ts");

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(entry)) out.push(full);
  }
  return out;
};

/*
 * **A missing search directory is could-not-measure, not a pass.**
 *
 * The first version swallowed a failed `walk` and carried on with the rest, so renaming `apps/web`
 * made this report success over 63 files where it had checked 187 — a smaller number nobody is
 * counting, which is the shape that keeps catching this project. Found by mutation-testing the
 * guard rather than by reading it.
 *
 * Every entry in SEARCH must exist. A directory that is genuinely gone is a change to this list,
 * which is a deliberate act and should look like one.
 */
const files = [];
for (const dir of SEARCH) {
  const full = path.join(root, dir);
  try {
    files.push(...walk(full));
  } catch (error) {
    console.error(`COULD NOT MEASURE: ${dir} is unreadable: ${error.message}`);
    console.error("Every directory in SEARCH must exist — a vanished one would silently shrink");
    console.error("the scope of this check rather than failing it.");
    process.exit(2);
  }
}
if (files.length === 0) {
  console.error(`COULD NOT MEASURE: no source files found under ${SEARCH.join(", ")}`);
  process.exit(2);
}

const found = [];
for (const file of files) {
  if (exempt(file)) continue;
  const source = readFileSync(file, "utf8");
  for (const [index, line] of source.split("\n").entries()) {
    // a fragment identifier in a URL or an anchor is not a colour
    if (/https?:\/\/|href=|#!\//.test(line)) continue;
    for (const hex of line.match(HEX) ?? []) {
      found.push({ file: path.relative(root, file), line: index + 1, hex });
    }
  }
}

if (found.length > 0) {
  console.error(`${found.length} hex colour literal(s) outside packages/design-tokens:`);
  for (const hit of found.slice(0, 25)) console.error(`  ${hit.file}:${hit.line}  ${hit.hex}`);
  if (found.length > 25) console.error(`  … and ${found.length - 25} more`);
  console.error("");
  console.error("Use a token. Colour belongs in packages/design-tokens/src/tokens.ts, and the CSS");
  console.error("custom properties are generated from it — a hex here will not follow the theme.");
  process.exit(1);
}

console.log(`no hex colour literals outside the tokens package (${files.length} files).`);
