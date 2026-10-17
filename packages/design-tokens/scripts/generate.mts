/**
 * Write the generated stylesheet. The only path from `tokens.ts` to CSS.
 *
 * Checked into the repo rather than built at install time, so a reader of `apps/web` can see the
 * values without running anything — and `check-tokens-css.mjs` fails the build when the file on
 * disk disagrees with what this would produce, which is what stops the two drifting.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { tokensCss } from "../src/css.js";

const out = path.resolve(import.meta.dirname, "../../../apps/web/app/tokens.generated.css");
writeFileSync(out, tokensCss());
console.log(`wrote ${out}`);
