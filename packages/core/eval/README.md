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

**Silence is not an answer.** Omitting `totalMinutes` scores wrong even where the
expected value is `null`. An extractor that says "I looked, there is none" is
worth more than one that says nothing, because silence can't be told apart from a
crash — and an extractor that never emits a field would otherwise score full
marks on every recipe that happens to lack it. Emit `null` explicitly. The report
prints `—` for silence and `none` for an asserted absence.

## Reading the report

The failure diffs are the point. A percentage tells you a change made things
worse; the diffs tell you what to do about it.

Today's run shows tier 0 scoring 100% on ingredient fields, 0% on title,
servings and time, and emitting spurious lines for headings and titles. That's
accurate: `parseIngredientList` reads ingredient lines and claims nothing else.
It's also the argument for the extractor tiers above it — and the harness now
measures whether each tier earns its cost.
