# Roadmap

**Current position: end of Phase 1. Phase 2 is next.**

Built: `packages/core` (88 tests), `packages/db` (18 tables, RLS, seeded catalog),
`packages/platform-client` (the seam, entitlement token). 176 tests across three
packages.

One Phase 1 item remains open, deliberately: **Stripe → entitlement issuance** is
blocked on Apple's outside-purchase rules (`docs/decisions.md`, Unresolved).
Everything it will write to is built — `subscriptions` is `provider` +
`external_id`, and `entitlements` is what the token is minted from.

Tasks are written to be picked up one at a time. Each should end with
`pnpm check` passing.

---

## Phase 0 — Domain core

*No UI. No infrastructure. This is the only code that would genuinely hurt to
rebuild, and everything else depends on it.*

- [x] `packages/core` — parser, units, catalog matching, package maths,
      consolidation. 88 tests, typecheck clean.
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
- [x] `packages/platform-client` — `getSession`, `getEntitlement`,
      `consumeQuota`, `registerDevice`. The seam, behind a `PlatformStore` port
      with Supabase and in-memory implementations. Quota spending is one atomic
      conditional `UPDATE`, verified under twenty concurrent spends.
      `scripts/check-platform-tables.mjs` fails `pnpm check` if anything outside
      the seam queries a platform table.
- [x] Entitlement token: Ed25519, key ids for rotation, inclusive validity and
      grace boundaries, degradation to read-only and never locked. 59 tests
      covering tampering, forged signatures, unknown key ids, malformed input and
      both window boundaries to the millisecond.
- [ ] Stripe subscription + webhook → entitlement issuance. **Blocked** on Apple's
      outside-purchase rules — verify those before designing the flow.
- [x] **Read-only enforced server-side.** `private.household_can_write` is ANDed
      into every household table's insert, update and delete policy and referenced
      by no SELECT policy, so reading can never be denied — asserted by a migration
      self-check. `grace_until` became a column so the predicate and the token read
      the same window.
- [x] **Quota resets.** The period rollover happens inside
      `platform_spend_quota`, in the same locked statement as the spend, so no
      reset job can race it. Tested at the boundary and under concurrent spends
      across it.

---

## Phase 2 — Web app

- [ ] `apps/web` — Next.js shell, auth flow, household setup.
- [ ] **An HTTP surface for the seam.** `platform-client` needs the service role,
      so it cannot run in a browser or an app bundle. Web can call it server-side,
      but Phase 3's Expo app cannot — it needs routes in front of it. Cheaper to
      draw now than to retrofit when the native app is waiting on it.
- [ ] `packages/import` — tier 0 (structured recipe data), tier 1 (microdata and
      plugin markup), tier 2 (LLM cascade), tier 3 (vision). One provider
      interface; model as config.
      *Tiers 2 and 3 cannot be judged until the eval set has real fixtures — the
      harness is built but three placeholders measure nothing. That Phase 0 item is
      a real dependency of this one.*
- [x] `import_cache` keyed by URL hash, not by family. Built in `packages/db`:
      no `family_id`, no policies, service-role only. Needs a reader and writer.
- [ ] Photo pipeline: fetch server-side, resize, store, CDN. *No Storage bucket or
      its policies exist yet; `photos.storage_path` is a column pointing at
      nothing.*
- [ ] Port the prototype's screens: recipe list, detail with per-member ratings,
      week planner, shopping list with the split display, pantry.
      *`plan_entries.recipe_id` is NOT NULL, so a free-text planner entry
      ("leftovers") needs a migration.*
- [ ] Public recipe pages, server-rendered, indexable. **Needs schema work first:**
      recipes have no notion of being public, and `anon` holds no grant on any
      table. Decide how a recipe becomes public and whether the page is served by
      the service role or by a genuine anon-readable path — and note that loosening
      a SELECT policy promotes the UPDATE policy to load-bearing (see
      `packages/db/README.md`).
- [ ] Batch import with a job queue. *`import_jobs` exists; nothing drains it.*

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

## Known gaps in the foundations

Found by reviewing Phase 1 against itself. None of these are Phase 2 features;
they are load-bearing behaviour that nothing currently proves.

**`verify()` does not check expiry.** It checks the signature and nothing else;
the window is evaluated separately by `evaluateAccess`. Defensible — verification
is not authorisation — but it means every caller has to remember to do both, and
nothing enforces the pairing.

**Untested paths that carry weight:**

- Composite foreign keys are tested on `recipe_ingredients` only, not on `ratings`,
  `photos`, `plan_entries` or `shortlist_entries`.
- Seed idempotency was verified by hand, not by a test.
- `platform_spend_quota` being service-role-only was verified by hand.
- `registerDevice`'s revoked-device path.
- The `child_has_no_login` constraint.

---

## Working notes

**Order matters more than speed.** Phase 0 is the least satisfying and the
highest value. Resist skipping to UI.

**One task per session.** Each should be small enough to finish and verify.

**Stop at the open questions.** If a task requires Apple's billing rules or the
sync engine choice to be settled, say so rather than guessing —
`docs/decisions.md` lists them.
