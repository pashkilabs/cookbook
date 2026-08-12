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
| `packages/db` | Schema, migrations, RLS, generated types |
| `packages/platform-client` | The seam. Nothing else may touch platform tables |

## Status

**End of Phase 2's backend work.** 498 tests across four packages, typecheck clean.

| | |
|---|---|
| `packages/core` | Parser, units, catalog matching, package maths, consolidation. No DOM, no network, so it runs identically in Next.js, Expo and the worker. Plus the eval harness. |
| `packages/db` | 19 tables, row-level security on every household table, a private photo bucket, an atomic job queue, generated types, seeded grocery catalog. |
| `packages/platform-client` | The seam: session, entitlements, quota, devices, and the HTTP surface every client reaches it through. Ed25519 entitlement token, with read-only degradation enforced by RLS rather than by convention. |
| `packages/import` | Recipe import: deterministic tiers 0–1, a schema-constrained model at tier 2, vision at tier 3, a shared URL cache, photo storage and the job queue. |

Phase 2's backend is done; what remains of it is **the Next.js app and the screens**,
plus choosing the tier-2 and tier-3 models. **Stripe remains blocked** on Apple's
outside-purchase rules; everything it will write to exists. See `docs/roadmap.md` for
"Known gaps in the foundations".

Still outstanding from Phase 0: **real eval fixtures.** The harness runs against
three placeholders, which measure nothing, and the import tiers in Phase 2 cannot
be judged without them. See `packages/core/eval/README.md` for the format.
