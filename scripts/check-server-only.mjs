/**
 * Fail if server-only code is reachable from a client bundle.
 *
 * Two rules from CLAUDE.md that nothing else can enforce:
 *
 *   **Never call an inference API from the browser or the app.** Keys must never
 *   reach a client bundle. `@pashki/import` holds the LLM cascade, so importing it
 *   into a client component drags the provider — and whatever key it reads — into
 *   something that ships to a device.
 *
 *   **The seam needs the service role.** `@pashki/platform-client` cannot function
 *   in a browser, and a service-role key in a bundle is every household's data.
 *
 * A client context here is a React Native file or anything carrying a `"use client"`
 * directive. Server components, route handlers and API code are the default in
 * Next.js, so the check is on the exception rather than the rule.
 *
 *   node scripts/check-server-only.mjs
 */
import { lineOf, sourceFiles, stripComments } from "./lib/source-files.mjs";

const root = new URL("..", import.meta.url).pathname;

/** Packages that must never appear in a client bundle. */
const SERVER_ONLY = [
  "@pashki/import",
  "@pashki/platform-client",
  // the subpaths matter on their own: /crypto holds the signing key handling
  "@pashki/import/supabase",
  "@pashki/import/sharp",
  "@pashki/platform-client/crypto",
  "@pashki/platform-client/supabase",
];

/** Anything that looks like an inference or service-role credential. */
const SECRETS =
  /process\.env\.[A-Z0-9_]*(OPENAI|ANTHROPIC|GROQ|TOGETHER|GEMINI|INFERENCE|SERVICE_ROLE|SIGNING)[A-Z0-9_]*/;

/** The packages themselves are allowed to reference their own names in docs and tests. */
const ALLOWED_PREFIXES = [
  "packages/import/",
  "packages/platform-client/",
  "packages/db/",
  "scripts/check-server-only.mjs",
];

/**
 * A file that ships to a device.
 *
 * `"use client"` has to be the first statement to be a directive at all, so a mention
 * of it further down is not one — checking only the opening lines avoids treating a
 * comment about client components as a client component.
 */
function isClientContext(path, source) {
  if (path.startsWith("apps/mobile/")) return true;
  const opening = stripComments(source).trimStart().slice(0, 40);
  return /^["']use client["']/.test(opening);
}

const offenders = [];

for (const { path, source } of sourceFiles(root)) {
  if (ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
  if (!isClientContext(path, source)) continue;

  const code = stripComments(source);

  for (const module of SERVER_ONLY) {
    const pattern = new RegExp(String.raw`from\s*["']${module}["']|require\(\s*["']${module}["']`);
    if (pattern.test(code)) {
      offenders.push({ path, line: lineOf(source, pattern), detail: module });
    }
  }
  if (SECRETS.test(code)) {
    offenders.push({ path, line: lineOf(source, SECRETS), detail: "a server-only credential" });
  }
}

if (offenders.length > 0) {
  console.error("server-only code is reachable from a client bundle:\n");
  for (const { path, line, detail } of offenders) {
    console.error(`  ${path}:${line}  (${detail})`);
  }
  console.error(
    "\nInference and the platform seam run server-side only. Call them from a route" +
      "\nhandler or a server component and pass the result down — never import them" +
      "\ninto something that ships to a device.",
  );
  process.exit(1);
}

console.log(
  `server-only modules (${SERVER_ONLY.length}) are absent from client contexts.`,
);
