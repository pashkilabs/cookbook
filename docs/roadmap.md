# Roadmap

**Current position: Phase 0, roughly half done.**

Tasks are written to be picked up one at a time. Each should end with
`pnpm check` passing.

---

## Phase 0 — Domain core

*No UI. No infrastructure. This is the only code that would genuinely hurt to
rebuild, and everything else depends on it.*

- [x] `packages/core` — parser, units, catalog matching, package maths,
      consolidation. 60 tests, typecheck clean.
- [ ] **Eval set.** `packages/core/eval/fixtures/` — 50+ real recipes across
      URLs, pasted captions and reel screenshots, each with hand-checked
      expected output. Needs real sources; ask before inventing fixtures.
      *The format and three placeholders are in place — see
      `packages/core/eval/README.md`. Adding one is: write the file, import it,
      drop `placeholder: true`.*
- [x] **Eval harness.** `packages/core/eval/` — fixture set × extractor →
      per-field accuracy (title, servings, amount, unit, item), ingredient
      recall and precision, cost per run, and a diff for every failure.
      `pnpm --filter @pashki/core eval`. Extractors are plain functions, so a
      model plugs in without touching the harness.
- [ ] **Catalog expansion.** Grow `SEED_CATALOG` toward the items a real family
      buys. Every addition needs a package list in base units.

---

## Phase 1 — Foundations

- [x] `packages/db` — schema and migrations. 18 tables per
      `docs/architecture.md` §5, applied from clean. Row-level security on every
      household table keyed on `family_id`, with the migration asserting its own
      coverage. 21 isolation tests, mutation-tested via
      `pnpm --filter @pashki/db test:mutate` so a weakened policy fails a test.
      Generated types committed.
- [x] Seed `ingredients` and `grocery_packages` from `SEED_CATALOG`. 55
      ingredients, 97 package sizes, in a `seed.sql` generated from the constant
      rather than hand-copied. Idempotent. A round-trip test rebuilds the catalog
      from the database and asserts it consolidates a known week identically to
      `createCatalog(SEED_CATALOG)`, and
      `scripts/check-seed-catalog-usage.mjs` (wired into `pnpm check`) fails if
      anything outside seeding and tests references the constant.
- [ ] `packages/platform-client` — `getSession`, `getEntitlement`,
      `consumeQuota`, `registerDevice`. The seam. Design the interface as though
      three more apps will use it.
- [ ] Entitlement token: signing, validity window, grace period, read-only
      degradation.
- [ ] Stripe subscription + webhook → entitlement issuance.

---

## Phase 2 — Web app

- [ ] `apps/web` — Next.js shell, auth flow, household setup.
- [ ] `packages/import` — tier 0 (structured recipe data), tier 1 (microdata and
      plugin markup), tier 2 (LLM cascade), tier 3 (vision). One provider
      interface; model as config.
- [ ] `import_cache` keyed by URL hash, not by family.
- [ ] Photo pipeline: fetch server-side, resize, store, CDN.
- [ ] Port the prototype's screens: recipe list, detail with per-member ratings,
      week planner, shopping list with the split display, pantry.
- [ ] Public recipe pages, server-rendered, indexable.
- [ ] Batch import with a job queue.

**Ship this. Use it as a family for a month before writing native code.**

---

## Phase 3 — Native

- [ ] `apps/mobile` — Expo shell, EAS build config.
- [ ] Local SQLite + sync engine. Tombstones for deletes.
- [ ] Share target — receive links, text and images from other apps.
- [ ] Camera: photograph the finished plate.
- [ ] Cook mode: step through the method with ingredients pinned; rate at the
      end.
- [ ] Shopping mode: large tap targets, works with no signal.
- [ ] RevenueCat for cross-platform entitlements.
- [ ] TestFlight — **far earlier than feels comfortable.**

---

## Phase 4 — Media

- [ ] `apps/worker` — container with ffmpeg.
- [ ] Audio extraction → transcription.
- [ ] Frame sampling with scene detection; favour frames containing text.
- [ ] OCR the sampled frames.
- [ ] Fusion: transcript (method) + frames (amounts) + caption (title and list)
      → one recipe. Flag every amount the video didn't actually state.
- [ ] Push notification when a job completes.
- [ ] Share a video file from the camera roll into the pipeline.

---

## Phase 5 — Platform extraction

Generalise what app #2 actually needs. Not before.

---

## Working notes

**Order matters more than speed.** Phase 0 is the least satisfying and the
highest value. Resist skipping to UI.

**One task per session.** Each should be small enough to finish and verify.

**Stop at the open questions.** If a task requires Apple's billing rules or the
sync engine choice to be settled, say so rather than guessing —
`docs/decisions.md` lists them.
