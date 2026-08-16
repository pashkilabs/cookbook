/**
 * The deterministic baseline: what tiers 0 and 1 score with no model wired at all.
 *
 * This is the number a paid tier has to beat, so it lives as a command rather than a script
 * somebody has to reconstruct. `pnpm --filter @pashki/import eval`.
 *
 * Two figures, because they answer different questions. The cascade reads URLs and skips
 * captions — there is no markup in a caption for tier 0 or 1 to read. So the caption row uses
 * core's line parser as a stand-in: not a rival to a model, but the floor beneath it.
 */
import { createImportExtractor } from "./src/eval-extractor.js";
import { coreParser, FIXTURES, formatReport, runEval } from "@pashki/core/eval";
import type { Extractor } from "@pashki/core/eval";

const cascade = createImportExtractor({ skipPhoto: true });
const withFallback: Extractor = async (input) => (await cascade(input)) ?? coreParser(input);

const urls = await runEval(FIXTURES, cascade, { label: "tier 0/1 — urls, no model" });
console.log(formatReport(urls).split("skipped —")[0]);
console.log("─".repeat(72));
const all = await runEval(FIXTURES, withFallback, {
  label: "tier 0/1 + core line parser on captions — the floor a model must clear",
});
console.log(formatReport(all).split("skipped —")[0]);

if (process.argv.includes("--items")) {
  console.log("\nitem failures:");
  for (const o of urls.outcomes) {
    if (!o.score) continue;
    for (const line of o.score.ingredients) {
      if (line.itemCorrect) continue;
      console.log(`  ${o.fixture.id}: want ${JSON.stringify(line.expected.item)} got ${line.actual ? JSON.stringify(line.actual.item) : "(missing)"}`);
    }
    for (const sp of o.score.spurious) console.log(`  ${o.fixture.id}: spurious ${JSON.stringify(sp.item)}`);
  }
}
