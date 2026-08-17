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
import { readFile } from "node:fs/promises";
import { createImportExtractor } from "./src/eval-extractor.js";
import { createSharpImagePreparer } from "./src/sharp-preparer.js";
import { providerFromEnv } from "./src/openai-compatible.js";
import { visionProviderFromEnv } from "./src/anthropic.js";
import { PLACEHOLDER_CASCADE, RECIPE_JSON_SCHEMA } from "./src/provider.js";
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
  /*
   * One call before the fleet.
   *
   * A provider that is down, rate-limited or out of credit would otherwise fail all seventeen
   * caption fixtures and be reported as seventeen bad extractions. That is the wrong shape
   * entirely: it is one broken measurement, not seventeen bad answers, and the run must say
   * "could not measure" rather than produce a number.
   */
  try {
    await provider.extract({
      model: models[0]!,
      content: "1 cup flour",
      instructions: "Extract the recipe.",
      responseSchema: RECIPE_JSON_SCHEMA,
    });
  } catch (error) {
    console.log("\n" + "─".repeat(72));
    console.log(`tier 2  COULD NOT MEASURE — ${String((error as Error).message).slice(0, 160)}`);
    console.log("  The provider answered, so the key and the base URL are right; the call itself");
    console.log("  did not complete. Nothing has been measured against a model.");
    process.exit(2);
  }

  /*
   * Vision is a separate list, not a flag on the text models (§7): the escalation order for
   * images is its own question, and the reels are the hardest input in the product.
   */
  /*
   * Vision has its own provider as well as its own model (§7): Anthropic speaks /v1/messages and
   * a forced tool call, Together speaks Chat Completions. The text workhorse is untouched.
   */
  // the same builder the product uses, so the measured path and the shipping path are one
  const visionProvider = visionProviderFromEnv();
  const visionModel = process.env.PASHKI_LLM_VISION_MODEL;
  const withModel = createImportExtractor({
    skipPhoto: true,
    llm: {
      provider,
      models,
      ...(visionModel && visionProvider
        ? {
            visionProvider,
            visionModels: [{ provider: visionProvider.key, model: visionModel, region: "us" as const, temperature: 0 }],
          }
        : {}),
    },
    reportUsage: true,
    // screenshots are 1.5–3.7 MB phone captures and the vision path caps an image at 1.5 MB;
    // the passthrough preparer rejects them all, which reads as "vision failed" when nothing
    // was ever sent. sharp is what makes a reel sendable (roadmap, §7).
    preparer: createSharpImagePreparer(),
    loadImage: async (path: string) =>
      new Uint8Array(await readFile(new URL(`../core/eval/intake/screenshots/${path}`, import.meta.url))),
  });
  if (!visionModel) console.log("  (no PASHKI_LLM_VISION_MODEL — reels will skip rather than score)");
  /*
   * Repeated, because a model run is a sample and not a measurement.
   *
   * At temperature 0 the same command produced different scored/skipped sets between runs — a
   * mixture-of-experts model is not deterministic just because the sampler is. One run compared
   * against one earlier run is how a model comes to look better or worse than it is, so the
   * report gives a mean and a spread, and names any fixture whose status moved.
   */
  const runs = Number(process.env.PASHKI_EVAL_RUNS ?? "1");
  const reports = [];
  for (let i = 0; i < runs; i += 1) {
    reports.push(await runEval(FIXTURES, withModel, { label: `${models[0]!.model} run ${i + 1}` }));
  }

  console.log("\n" + "─".repeat(72));
  if (runs === 1) {
    console.log(formatReport(reports[0]!).split("skipped —")[0]);
    console.log("  ONE RUN — a sample, not a measurement. Set PASHKI_EVAL_RUNS=5 for a spread.");
  } else {
    const FIELDS = ["title", "servings", "totalMinutes", "amount", "unit", "item"] as const;
    const pct = (c: number, t: number) => (t ? (c / t) * 100 : 0);
    const show = (name: string, values: number[]) => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const lo = Math.min(...values), hi = Math.max(...values);
      console.log(`${name.padEnd(11)} ${mean.toFixed(1).padStart(5)}%   spread ${lo.toFixed(1)}–${hi.toFixed(1)}  (±${((hi - lo) / 2).toFixed(1)})`);
    };
    console.log(`eval — ${models[0]!.model}${visionModel ? ` + ${visionModel}` : ""} · ${runs} runs\n`);
    for (const f of FIELDS) show(f === "totalMinutes" ? "time" : f, reports.map((r) => pct(r.byField[f].correct, r.byField[f].total)));
    show("overall", reports.map((r) => pct(r.overall.correct, r.overall.total)));
    show("sections", reports.map((r) => pct(r.sections.correct, r.sections.total)));
    show("recall", reports.map((r) => pct(r.ingredients.found, r.ingredients.expected)));
    const costs = reports.map((r) => r.cost.usd);
    console.log(`cost        $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)}   spread $${Math.min(...costs).toFixed(4)}–$${Math.max(...costs).toFixed(4)}`);

    // a fixture that scores in one run and skips in the next is the instability that matters
    const status = new Map<string, Set<string>>();
    for (const r of reports) for (const o of r.outcomes) {
      if (!status.has(o.fixture.id)) status.set(o.fixture.id, new Set());
      status.get(o.fixture.id)!.add(o.status);
    }
    const unstable = [...status].filter(([, s]) => s.size > 1);
    console.log(`\nfixtures whose status moved between runs: ${unstable.length}`);
    for (const [id, s] of unstable) console.log(`  ${id} — ${[...s].join(" / ")}`);
    if (unstable.length) {
      console.log("\n  A difference inside the spread above is not a result.");
    }
  }
}
