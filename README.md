# Pashki

One family subscription, a portfolio of apps. This repo holds the platform and
its first tenant: a **recipe app** that captures recipes from anywhere on the
internet, learns who in a household likes what, plans a week of meals, and
builds a shopping list that consolidates ingredients across recipes.

The consolidation is the point. Two recipes needing a cup and a half-cup of
cream become *buy one pint*, split across Tuesday and Friday, with the leftover
shown and a suggestion for a third recipe that would finish it.

## Getting started

```bash
nvm use            # Node 20.11+
pnpm install
pnpm check         # typecheck + tests
```

Copy `.env.example` to `.env.local` and fill it in as services come online.
Nothing is needed yet for `packages/core`.

## Working on this

Open the repo root in VS Code and run Claude Code from there so it picks up
`CLAUDE.md`. Useful commands:

| | |
|---|---|
| `/next` | take the next roadmap task |
| `/check` | typecheck and test, with an honest report |
| `/decide` | record a decision with its reversal condition |

## Where things are

| | |
|---|---|
| `CLAUDE.md` | Project rules and traps already hit. Read first. |
| `docs/architecture.md` | Full design: stack, data model, pipelines, phases |
| `docs/decisions.md` | What was chosen, why, and what would reverse it |
| `docs/roadmap.md` | Phases as tasks, and current position |
| `packages/core` | The domain logic. The part worth being precious about. |

## Status

**Phase 0, over half done.** `packages/core` is built and tested — 89 tests,
typecheck clean, no DOM or network dependencies, so it runs identically in
Next.js, Expo and the import worker.

The eval harness is in (`pnpm --filter @pashki/core eval`), which turns model
selection into a measurement rather than an argument. It runs against three
placeholder fixtures today.

Next up: real fixtures. 50+ recipes from actual sources — URLs, pasted captions,
reel screenshots — each with hand-checked expected output. See
`packages/core/eval/README.md` for the format.
