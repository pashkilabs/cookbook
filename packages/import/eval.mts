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
import { providerFromEnv } from "./src/openai-compatible.js";
import { PLACEHOLDER_CASCADE } from "./src/provider.js";
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

/*
 * Tier 2, when there is a model to call.
 *
 * Absent a key this prints why and stops rather than running: an extractor that was never
 * configured scoring nothing must not be reported beside one that answered badly.
 */
const provider = providerFromEnv();
if (!provider) {
  console.log("\n" + "─".repeat(72));
  console.log("tier 2  NOT MEASURED — no model configured.");
  console.log("  Set PASHKI_LLM_BASE_URL and PASHKI_LLM_API_KEY (and optionally");
  console.log("  PASHKI_LLM_MODEL, PASHKI_LLM_INPUT_PER_MILLION, PASHKI_LLM_OUTPUT_PER_MILLION)");
  console.log("  and re-run. Nothing below the floor above has been measured against a model.");
} else {
  const models = process.env.PASHKI_LLM_MODEL
    ? [{ provider: provider.key, model: process.env.PASHKI_LLM_MODEL, region: "us" as const, temperature: 0 }]
    : PLACEHOLDER_CASCADE;
  const withModel = createImportExtractor({
    skipPhoto: true,
    llm: { provider, models },
    reportUsage: true,
  });
  console.log("\n" + "─".repeat(72));
  const tier2 = await runEval(FIXTURES, withModel, { label: `tier 0/1/2 — ${models[0]!.model}` });
  console.log(formatReport(tier2).split("skipped —")[0]);
}
