# Eval harness

Turns "which extractor is better" into a number and, more usefully, into a list
of what each one got wrong.

```bash
pnpm --filter @pashki/core eval
```

Nothing here calls a model. The extractor interface is how inference arrives
later; today the only extractor is core's line parser.

## Shape

| File | Does |
|---|---|
| `types.ts` | Fixture format and the `Extractor` seam |
| `score.ts` | Comparison rules — normalisation, tolerance, ingredient pairing |
| `runner.ts` | Fixture set × extractor → report |
| `report.ts` | Report → readable text |
| `validate.ts` | Catches mistakes in hand-authored fixtures |
| `fixtures/` | The fixture set |
| `extractors/` | Things that turn an input into a recipe |
| `run.ts` | The CLI |

## Two baselines, read differently

**The deterministic baseline is reproducible by construction.** Tiers 0 and 1 read captured
markup with no network and no model, so the same fixtures give the same score every time —
verified by running it twice and comparing the output byte for byte. A change in that number is
a change in the code.

**A model baseline is a sample.** At `temperature: 0` the same command produced different
scored/skipped sets between runs: a mixture-of-experts model is not deterministic just because
the sampler is. So:

- **A single run is not comparable to a single earlier run.** Set `PASHKI_EVAL_RUNS=5`; the report
  gives a mean, a spread, and the fixtures whose status moved between runs.
- **A difference inside the spread is not a result.** Before believing a model is better, check
  the gap is bigger than the noise — and say which it is when reporting.

Measured over five runs of `openai/gpt-oss-120b` + `google/gemma-4-31B-it`:

| field | mean | spread |
|---|---|---|
| overall | 80.4% | 76.9–82.6 (±2.8) |
| item | 76.3% | 73.4–77.8 (±2.2) |
| amount | 86.4% | 82.3–88.4 (±3.1) |
| servings | 76.1% | 69.0–82.1 (**±6.6**) |
| sections | 61.3% | 56.0–65.3 (±4.7) |
| cost | $0.0141 | $0.0116–$0.0164 |

**Seven of thirty-five fixtures changed status between runs** — six captions that scored in some
runs and skipped in others, and one reel that did the reverse. The same input, the same
temperature, a different answer. That is the noise floor, and it is why `overall 84.3%` from a
single run was never a measurement.

## The baseline

**There is no earlier number to compare against.** A 23/23 figure exists in an old session
report, but its URLs were discovered from live listing pages and never recorded, so it cannot be
reproduced and cannot be a baseline — a number you cannot re-measure is an anecdote. Whatever this
harness reports over the first real fixture set **is** the first baseline, and the tier-2 and
tier-3 model choices are measured against it rather than against anything predating it.

That is the number tier 2 has to earn. If deterministic extraction answers most of the set, a
model has to beat it by enough to justify the cost and the latency on every import that would
otherwise never leave tier 0.

## What a URL fixture stores

**The extracted markup, not the page.** The JSON-LD `Recipe` node plus the ingredient markup, and
nothing else. Real pages run 300–680 KB of ads and scripts each; eighteen of those is several
megabytes nobody will ever read, and *an unreviewable fixture rots* — its expectation stops being
checkable against its input, which is the one thing a fixture is for. The trimmed capture still
exercises tiers 0 and 1, which are the tiers that read markup.

Every capture carries `url` and `capturedAt`. A snapshot is a claim about a page at a moment;
without the date, a fixture that stops matching the live page is indistinguishable from one that
was always wrong. `validateFixtures` refuses a dated-less capture, and exempts placeholders,
whose markup is invented rather than captured.

## Adding a fixture

The committed three are **placeholders** demonstrating one input shape each.
They measure nothing — real fixtures come from real sources.

Write a file in `fixtures/`, import it in `fixtures/index.ts`, and drop
`placeholder: true`. The expected output must be **read off the source by hand**,
not copied from what an extractor produced — otherwise the eval measures
agreement with today's bugs.

```ts
export const someRecipe: Fixture = {
  id: "smittenkitchen-vodka-rigatoni",
  source: "https://…   captured 2026-08-11",
  input: { kind: "url", url: "https://…", text: "<saved page snapshot>" },
  expected: {
    title: "Vodka Rigatoni",
    servings: 4,
    totalMinutes: 35,
    ingredients: [{ amount: 1, unit: "cup", item: "heavy cream" }],
  },
};
```

Three things to get right:

**URL fixtures carry a saved snapshot.** The harness never fetches. A score you
can't reproduce next month isn't a measurement, and `packages/core` has no
network. Capture the page once, commit the text.

**Units are canonical keys** — `tbsp`, not `tablespoons`; `null`, not `count`,
for whole things. `validateFixtures` flags both, so run the eval after adding
one.

**Amounts are as written, not in base units.** `1 cup` is `{amount: 1, unit:
"cup"}`. Base-unit conversion is `toBaseMeasure`'s job and is tested elsewhere;
mixing the two here would score the converter instead of the extractor.

`totalMinutes` is minutes because a number can be compared and "1 hr 20"
cannot — the same reason base units exist.

## Plugging in an extractor

An extractor is a function. Return `null` for an input it doesn't handle.

```ts
const gpt: Extractor = async (input) => {
  if (input.kind === "screenshot") return null;
  const recipe = await callModelServerSide(input.text);
  return { ...recipe, usage: { model: "…", costUsd: 0.0004 } };
};

console.log(formatReport(await runEval(FIXTURES, gpt, { label: "gpt-5.6-luna" })));
```

Returning `null` is not scored — it's counted as skipped and reported
separately. A text-only extractor forced to guess at screenshots would produce a
zero that says nothing about the extractor.

`usage` is optional and summed into the report's cost line, which is what makes
a model swap a comparison rather than an argument.

## Refusals and sections

Two things a fixture can say that are not "here is a recipe":

**A refusal** (decisions §46). Some inputs have no recipe in them — a listing page, a forum
thread, a caption reading *"comment CHICKEN and I'll DM you the full recipe"*. The correct output
is a refusal naming why, and a plausible recipe is the worst possible answer. Write it as
`expected: { outcome: "refusal", because: "no-recipe-in-source" }`; an extractor answers with
`{ refused: { because } }`.

`null` is **not** a refusal — it means "I do not handle this kind of input" and is recorded as
skipped. Conflating them would let an extractor that skips everything score perfectly on every
refusal fixture, which is this repo's oldest trap wearing a new hat.

The report names the two failures separately: **CONFABULATED** (a recipe invented for an input
with none) and **FALSE REFUSALS** (a real recipe declined).

**A section** (decisions §45). Ingredients carry the heading they sat under —
`section: "For the sauce"` — or `null`. A heading is never itself an expected ingredient; an
extractor emitting one has produced a spurious line. Sections are tallied on their own line and
deliberately kept out of the headline accuracy: a wrong section misgroups a display, a wrong
amount buys the wrong food, and one percentage covering both hides which moved.

## When a total time may be added up

**Add stated durations only where the source presents them as the whole.**

`instagram-texas-twinkies` says "1 hour" then "an additional 20-30 mins" — two components of one
complete cook, offered as the whole thing, so the total is 90 (upper bound, as for any range).
`instagram-cinnamon-rolls` scatters five durations through its method — proof, mix, rest, second
rest, bake — and adding them means deciding what is concurrent and what is not. That is
reconstruction, not arithmetic, so its total is `null`.

The line is whether the source hands you the parts of a whole or leaves them lying in the prose.

## Two known warts, recorded so they are not fixed by accident

**`2 ears of corn` is `amount: 2, unit: null, item: "ears of corn"`.** `ear` canonicalises to
`count`, and the validator requires a count be written as `null`, so the noun is stranded in the
item text. It reads oddly and it is right: a countable-noun model in the parser is real work, and
it must not arrive through a fixture quietly asserting one exists.

**A source that names no dish expects `title: null`.** The alternative — inventing a plausible
title — teaches an extractor exactly the habit the amount rules forbid.

## How scoring works

**Item and unit: exact after normalisation.** Units resolve through
`canonicalUnit`, so `tablespoons` and `T` both match `tbsp`. Items go through
`lightName` — the *gentle* normaliser, deliberately. `normaliseName` strips prep
words, which would let an extractor turn a tin of diced tomatoes into fresh
tomatoes and still score full marks. That's the exact bug core's tests guard
against, so the eval must not forgive it.

**Amounts: within 2%, or 0.01 absolute, whichever is larger.** The relative band
lets `240 ml` pass for a cup; the absolute floor lets `0.33` pass for a third.
`14.5` vs `15` fails — that's a different tin.

**Ingredients are paired by name, not by position.** One missing line would
otherwise shift every line after it and turn one error into a wall of noise.
Pairing is greedy on word overlap above `matchThreshold`; below it, the lines are
reported as one missing and one spurious instead.

The threshold changes the score slightly, not just its presentation: a paired
near-miss earns credit for a correct amount, an unpaired one earns none. 0.5 is
the default and lives in `DEFAULT_SCORE_OPTIONS` with the tolerances.

**Every check counts once** — three recipe fields per fixture, three per expected
ingredient, one per spurious line. A missing ingredient fails all three of its
checks, so an extractor can't score well on amounts by finding only the easy
ingredients. Spurious lines cost something, so emitting fifty junk lines is not
free.

**Absence is the same answer as `null`.** Omitting `totalMinutes` and asserting it
`null` score identically — `undefined` is normalised to `null` before anything is
compared. Schema-constrained model output routinely omits nulls, and the wrapper
around a model controls field presence rather than the model itself, so grading
presence would grade our own adapter code instead of extraction quality.

The signal that costs us is an extractor that never attempts a field at all,
which would otherwise hide inside a low per-field percentage. The report carries
that as one header line — `!! time was never emitted across 20 fixtures` — rather
than as N failures that each look like a wrong answer.

## Reading the report

The failure diffs are the point. A percentage tells you a change made things
worse; the diffs tell you what to do about it.

Today's run shows tier 0 scoring 100% on ingredient fields, 0% on title,
servings and time, and emitting spurious lines for headings and titles. That's
accurate: `parseIngredientList` reads ingredient lines and claims nothing else.
It's also the argument for the extractor tiers above it — and the harness now
measures whether each tier earns its cost.
