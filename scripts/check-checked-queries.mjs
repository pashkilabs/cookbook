#!/usr/bin/env node
/**
 * A page that renders data must check whether its query worked.
 *
 * `const { data } = await supabase.from(…)` discards `error`, and `data ?? []` then renders a
 * failed query as an empty list — a broken screen wearing an empty one's clothes. That shape has
 * caused three silent failures here: the browse screen querying columns that did not exist on the
 * deployed database, classification selecting a column name that was wrong so every recipe was
 * read without its ingredients, and a recipe list rendering empty rather than saying why.
 *
 * Each was written by someone who knew the rule, so this is not a fourth reminder — `lib/rows.ts`
 * makes the checked version the easy one and this stops the unchecked one coming back.
 *
 * **Scoped to what is converted.** Routes and lib still use the bare form; a guard that fired on
 * them would be a red gate nobody could clear, and that is how guards get disabled. Widen the
 * scope in the same change that converts the next slice, never before it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SCOPE = "apps/web/app";
const offenders = [];

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith("page.tsx")) check(path);
  }
})(SCOPE);

function check(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    // `const { data … } = await` with no `error` beside it, on a postgrest call rather than auth
    if (!/const \{\s*data\b[^}]*\}\s*=\s*await/.test(line)) return;
    if (/\berror\b/.test(line)) return;
    // auth.getUser() is deliberately exempt: a null user is the answer, not a failure
    const window = lines.slice(index, index + 3).join(" ");
    if (/auth\.getUser\(\)|\.storage\b/.test(window)) return;
    offenders.push(`${path}:${index + 1}`);
  });
}

if (offenders.length > 0) {
  console.error("these render paths discard a query's error, so a failure renders as empty:");
  for (const at of offenders) console.error(`  ${at}`);
  console.error("\nUse rows() or maybeRow() from @/lib/rows — they return the data or throw.");
  process.exit(1);
}

console.log(`every page checks its queries (${SCOPE}/**/page.tsx).`);
