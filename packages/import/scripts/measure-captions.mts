import { readFileSync, readdirSync } from "node:fs";
import {
  CAPTION_AXIS_EXPECTATIONS,
  CAPTION_CLASS_EXPECTATIONS,
  scoreAxis,
  scoreCourse,
  scoreCuisine,
  type ClassVerdict,
} from "@pashki/core/eval";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { extractWithLlm } from "../src/tier2.js";

/**
 * Score caption classification against the hand adjudication, over N runs.
 *
 * ---------------------------------------------------------------------------
 * Why this exists: "18/18 across the caption set" had no runner
 * ---------------------------------------------------------------------------
 *
 * That figure is quoted as settled in `classify.ts` and inside the reasoning of
 * `20260818120000_dish_form_and_protein.sql`, and the course instruction was written against it.
 * Everything needed to re-measure it was already here — eighteen caption files under
 * `eval/intake/captions`, `CAPTION_CLASS_EXPECTATIONS` and `CAPTION_AXIS_EXPECTATIONS` covering
 * all four axes, and three scorers that keep right, declined and wrong apart — and **nothing
 * joined them**. The only consumer of that file was a unit test of the scoring functions.
 *
 * So the number came from a hand run whose answers were never written down. It is reproducible in
 * principle and was not reproducible in practice, which is the eval README's own test for an
 * anecdote: *"a number you cannot re-measure is an anecdote"*. This is the join.
 *
 * ---------------------------------------------------------------------------
 * Runs, because one reading of a reasoning model is a sample
 * ---------------------------------------------------------------------------
 *
 * `openai/gpt-oss-120b` at `temperature: 0` answers differently between runs — a mixture of
 * experts is not deterministic because the sampler is fixed. The eval already knows this and
 * prints a mean and a spread; the classification axes were outside it. Default is three runs,
 * and a single run says so in words rather than printing a bare figure.
 *
 * ---------------------------------------------------------------------------
 * Three outcomes, never two
 * ---------------------------------------------------------------------------
 *
 * A decline and a wrong answer move the prompt in opposite directions: a model that declines on
 * an obvious main needs less caution, one that calls a soup a snack needs more. Averaging them
 * into an accuracy would let the prompt be tuned one way while the other error got worse, with
 * nothing to show it. `caption-steps.ts` argues this at length and the scorers implement it; this
 * reports it.
 */
const arg = (name: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;

const runs = Number(arg("runs") ?? "3");
const only = arg("only");
const captionDir = new URL("../../core/eval/intake/captions/", import.meta.url);

/*
 * The join, asserted in both directions before anything is measured.
 *
 * An expectation keyed to a file that does not exist scores nothing; a caption file no
 * expectation covers is a measurement nobody takes. Both are *which files does nothing check?*,
 * and both read as a clean run — so this is exit 2, not a warning. The keys here are intake
 * filenames and the keys in `FIXTURES` are fixture ids spelled differently (`caption-peach-posset`
 * against `instagram-peach-posset`); nothing is wrong with that, and it is exactly the kind of
 * near-miss a join nobody runs would hide.
 */
const onDisk = new Set(
  readdirSync(captionDir).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, "")),
);
const classKeys = new Set(CAPTION_CLASS_EXPECTATIONS.map((e) => e.fixture));
const axisKeys = new Set(CAPTION_AXIS_EXPECTATIONS.map((e) => e.fixture));
const problems: string[] = [];
for (const key of classKeys) if (!onDisk.has(key)) problems.push(`class expectation "${key}" has no caption file`);
for (const key of axisKeys) if (!onDisk.has(key)) problems.push(`axis expectation "${key}" has no caption file`);
for (const file of onDisk) {
  if (!classKeys.has(file)) problems.push(`caption "${file}" has no course/cuisine expectation`);
  if (!axisKeys.has(file)) problems.push(`caption "${file}" has no form/protein expectation`);
}
if (problems.length) {
  console.log(`COULD NOT MEASURE: the adjudication and the captions do not join (${problems.length})`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(2);
}

const cascade = cascadeFromEnv();
if (!cascade) {
  console.log("COULD NOT MEASURE: no inference provider configured");
  process.exit(2);
}

const subjects = CAPTION_CLASS_EXPECTATIONS.filter((e) => !only || e.fixture.includes(only)).map((e) => {
  const axis = CAPTION_AXIS_EXPECTATIONS.find((a) => a.fixture === e.fixture)!;
  return {
    fixture: e.fixture,
    text: readFileSync(new URL(`${e.fixture}.txt`, captionDir), "utf8"),
    course: e.course,
    cuisine: e.cuisine,
    dishForm: axis.dishForm,
    principalProtein: axis.principalProtein,
  };
});
if (!subjects.length) {
  console.log(`COULD NOT MEASURE: --only=${only} matched no caption`);
  process.exit(2);
}

const AXES = ["course", "cuisine", "dishForm", "principalProtein"] as const;
type Axis = (typeof AXES)[number];

interface Reading {
  fixture: string;
  /** null where the extractor returned no recipe at all — not four declines */
  verdicts: Record<Axis, ClassVerdict> | null;
  got: Record<Axis, unknown> | null;
}

console.log(`${subjects.length} captions, ${runs} run${runs === 1 ? "" : "s"}, model ${cascade.models[0]!.model}`);
console.log("nothing is written: this reads the intake files and scores what comes back\n");

const allRuns: Reading[][] = [];
for (let run = 0; run < runs; run += 1) {
  const readings: Reading[] = [];
  for (const subject of subjects) {
    /*
     * Three attempts, because a skip infrastructure timing could have caused gets retried before
     * it is believed. The first real run of this script lost 9 of 18 captions in one run to the
     * provider, and a lost caption is not a wrong answer — it is a hole in the denominator.
     */
    let recipe = null;
    for (let attempt = 0; attempt < 3 && !recipe; attempt += 1) {
      const result = await extractWithLlm({
        content: subject.text,
        sourceUrl: "",
        sourceName: null,
        cascade,
      });
      recipe = result.recipe;
    }
    if (!recipe) {
      readings.push({ fixture: subject.fixture, verdicts: null, got: null });
      process.stdout.write("!");
      continue;
    }
    const got: Record<Axis, unknown> = {
      course: recipe.course ?? null,
      cuisine: recipe.cuisine ?? null,
      dishForm: recipe.dishForm ?? null,
      principalProtein: recipe.principalProtein ?? null,
    };
    readings.push({
      fixture: subject.fixture,
      got,
      verdicts: {
        course: scoreCourse(subject.course, got.course),
        cuisine: scoreCuisine(subject.cuisine, got.cuisine),
        dishForm: scoreAxis(subject.dishForm, got.dishForm),
        principalProtein: scoreAxis(subject.principalProtein, got.principalProtein),
      },
    });
    process.stdout.write(".");
  }
  console.log("");
  allRuns.push(readings);
}

const tally = (readings: Reading[], axis: Axis) => {
  const scored = readings.filter((r) => r.verdicts);
  const of = (verdict: ClassVerdict) => scored.filter((r) => r.verdicts![axis] === verdict).length;
  return { right: of("right"), declined: of("declined"), wrong: of("wrong"), scored: scored.length };
};

for (const [index, readings] of allRuns.entries()) {
  const failed = readings.filter((r) => !r.verdicts);
  console.log(`\n=== run ${index + 1} of ${runs} ===`);
  if (failed.length) {
    // an extraction that returned nothing is not four correct declines: it is a reading that
    // did not happen, and scoring it would turn an outage into a good result
    console.log(`${failed.length} NOT MEASURED — the extractor returned no recipe: ${failed.map((f) => f.fixture).join(", ")}`);
  }
  console.log("axis               right  declined  wrong");
  for (const axis of AXES) {
    const t = tally(readings, axis);
    console.log(`  ${axis.padEnd(17)}${String(t.right).padStart(4)}/${t.scored} ${String(t.declined).padStart(8)} ${String(t.wrong).padStart(6)}`);
  }
  for (const axis of AXES) {
    const scored = readings.filter((r) => r.verdicts);
    const bad = scored.filter((r) => r.verdicts![axis] !== "right");
    if (!bad.length) continue;
    console.log(`  ${axis}:`);
    for (const r of bad) console.log(`    ${r.verdicts![axis].padEnd(8)} ${r.fixture} → ${JSON.stringify(r.got![axis])}`);
  }
}

/*
 * A mean and a spread, because a single figure from a reasoning model is a sample.
 *
 * Reported per axis rather than pooled: pooling four axes would hide that one of them is stable
 * and another is not, which is the whole question when deciding what a browse chip can lean on.
 */
/*
 * The spread is computed over the captions measured in EVERY run, and nothing else.
 *
 * Its first real run lost 9 of 18 captions to the provider in run 3, and this section averaged
 * that run's absolute `right` count beside two complete runs — printing `course 8-17 (±4.5)`
 * where the 8 was out of 9 and the 17 out of 18. **A spread across different denominators is an
 * artefact that reads as a finding**, and the NOT MEASURED line naming the nine was in the same
 * output, directly above it. So the common subset is the only honest denominator, the dropped
 * captions are named, and a run that lost any of them is called partial rather than averaged in
 * silently.
 */
const measuredEverywhere = subjects.filter((s) =>
  allRuns.every((r) => r.find((x) => x.fixture === s.fixture)?.verdicts),
);
const lostSomewhere = subjects.filter((s) => !measuredEverywhere.includes(s));
if (!measuredEverywhere.length) {
  console.log("\nCOULD NOT MEASURE: no caption was read successfully in every run");
  process.exit(2);
}

if (runs > 1) {
  console.log(`\n=== across ${runs} runs, over the ${measuredEverywhere.length} captions read in every one ===`);
  if (lostSomewhere.length) {
    console.log(`${lostSomewhere.length} excluded — lost to the provider in at least one run: ${lostSomewhere.map((s) => s.fixture).join(", ")}`);
    console.log("those runs are PARTIAL: re-run before quoting these figures as the set's accuracy");
  }
  const common = (readings: Reading[], axis: Axis) =>
    measuredEverywhere.filter((s) => readings.find((x) => x.fixture === s.fixture)!.verdicts![axis] === "right").length;
  console.log("axis               mean right   spread");
  for (const axis of AXES) {
    const counts = allRuns.map((r) => common(r, axis));
    const n = measuredEverywhere.length;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    console.log(
      `  ${axis.padEnd(17)}${mean.toFixed(1)}/${n}` +
        `${lo === hi ? "    stable" : `   ${lo}–${hi} (±${((hi - lo) / 2).toFixed(1)})`}`,
    );
  }

  // same denominator as the spread: an "unread" beside a verdict is a lost caption, not a verdict
  // that moved, and counting it reported 13 of 18 unstable where half of those were never read
  const moved = measuredEverywhere.filter((s) =>
    AXES.some((axis) => {
      const verdicts = allRuns.map((r) => r.find((x) => x.fixture === s.fixture)!.verdicts![axis]);
      return new Set(verdicts).size > 1;
    }),
  );
  console.log(`\ncaptions whose verdict moved between runs: ${moved.length} of ${measuredEverywhere.length}`);
  for (const s of moved) {
    const lines = AXES.filter((axis) => {
      const verdicts = allRuns.map((r) => r.find((x) => x.fixture === s.fixture)!.verdicts![axis]);
      return new Set(verdicts).size > 1;
    }).map((axis) => {
      const answers = allRuns.map((r) => {
        const reading = r.find((x) => x.fixture === s.fixture)!;
        return `${reading.verdicts![axis]}:${JSON.stringify(reading.got![axis])}`;
      });
      return `${axis} ${answers.join(" / ")}`;
    });
    console.log(`  ${s.fixture}`);
    for (const line of lines) console.log(`    ${line}`);
  }
} else {
  console.log("\nONE RUN — a sample, not a measurement. Pass --runs=3 or more before quoting a figure.");
}
