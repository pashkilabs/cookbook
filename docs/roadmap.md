# Roadmap

**Current position: Phase 2's backend is done. What remains of Phase 2 is the app
itself, and Phase 3 is next.**

Built: `packages/core`, `packages/db` (19 tables, RLS, photo bucket, job queue),
`packages/platform-client` (the seam, entitlement token, HTTP surface),
`packages/import` (tiers 0–3, shared cache, photo storage, job runner). 501 tests
across four packages.

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
- [x] **An HTTP surface for the seam.** Session, entitlement, quota spend and device
      registration, as a framework-agnostic router plus a Fetch adapter, so Next.js
      in Phase 2 and any host in Phase 3 share one implementation. The account is
      resolved from the caller's Supabase JWT and there is **no `accountId`
      parameter anywhere** — verified with real tokens, including one household
      naming another in its body. Handlers only; no app around them yet.
- [x] `packages/import` — **tiers 0 and 1**: structured recipe data, then microdata
      and plugin markup. Deterministic, no model calls. Typed failures rather than
      exceptions, image references resolved through the graph, images validated by
      decoding, blocked platforms rejected before a request. Wired to
      `import_cache` by URL hash. 76 tests.
- [x] `packages/import` **tier 2 structure**: one provider interface, model as a
      config value, provider-enforced JSON schema, our own validation deciding
      escalation, every tier attempt recorded, and the whole thing wired as an eval
      `Extractor`. Cached by URL hash alongside tiers 0 and 1.
      **Deliberately not tuned, and no production model chosen** —
      `PLACEHOLDER_CASCADE` is a stand-in. Both are measurements and the eval set
      still has three placeholder fixtures.
- [x] `packages/import` **tier 3 structure**: same provider interface extended with
      images, so a vision model is a config value; every frame fused in one call;
      estimated amounts flagged per ingredient; the model picks the dish photo by
      index among the user's own images; screenshots downscaled before sending
      (`@pashki/import/sharp`). Wired as an eval `Extractor`, and the screenshot
      fixture kind now takes several frames so fusion is measurable.
      **Not tuned, no model chosen** — vision is the weakest link (decisions §7) and
      needs the reel-screenshot fixtures more than any other tier.
- [ ] **Choose the tier-2 and tier-3 models, and tune both prompts.** Blocked on real
      eval fixtures — that Phase 0 item is now the only thing standing between a
      complete cascade and a measured model choice, and it blocks four separate
      decisions: text model, vision model, whether the model or core should parse
      amounts, and the image size limits.
- [x] `import_cache` keyed by URL hash, not by family. Table in `packages/db`,
      reader and writer in `packages/import`. URLs are normalised before hashing, so
      the same page shared four ways is one row.
- [x] Photo pipeline: fetch server-side, resize, store. Private `recipe-photos`
      bucket whose read policies consult the `photos` row, so storage and table agree
      by construction rather than by restatement; no client write policy; the
      migration asserts the bucket is private and that every anon read path checks
      recipe visibility. Display sizes come from the transformation CDN rather than
      stored variants. 18 tests, mostly negative.
- [ ] Port the prototype's screens: recipe list, detail with per-member ratings,
      week planner, shopping list with the split display, pantry.
      *`plan_entries.recipe_id` is NOT NULL, so a free-text planner entry
      ("leftovers") needs a migration. The method now has somewhere to live:
      `recipe_steps`, decisions §19.*
- [x] **Schema and policies for public recipe pages.** `recipes.visibility`, anon
      RLS policies plus column grants, and a migration self-check over the whole
      anon surface. Decisions §17 records flag-not-token; §18 records that the two
      previously-`masked` mutations now report `caught`, which was the acceptance
      criterion. Rendering the pages is still to do, and needs no further schema.
- [x] Batch import with a job queue. `import_claim_next_job` claims atomically with
      `FOR UPDATE SKIP LOCKED`, leases expire so a dead worker's job returns to the
      queue, quota is spent once per job through the seam and never for a cached URL,
      and terminal states carry the typed `ImportFailure`. A runner callable from a
      test or a route; `apps/worker` as a container is still a separate decision.
      Concurrency proven by twenty workers racing twelve jobs, and the test verified
      by breaking the claim.

**Ship this. Use it as a family for a month before writing native code.**

---

## Phase 3 — Native

- [x] **On-device data model design.** `docs/on-device.md` — which nine tables sync
      and which must never reach a phone, one household per device with the file as
      the boundary, the token's life on a device, key distribution, and which of the
      schema's constraints SQLite can hold. Decisions §20–§24. Design only; it
      chooses no engine.
- [ ] `apps/mobile` — Expo shell, EAS build config.
- [ ] Local SQLite + sync engine, evaluated against **decisions §24** — six
      disqualifying criteria and four ordered concessions. Tombstones for deletes.
- [ ] `GET /keys` on the seam, and a versioned catalog snapshot endpoint. Both are
      prerequisites for a device working offline (§21, §23), and both are small.
- [ ] The local write path and outbox — one choke point with the entitlement gate in
      it — plus the post-sync integrity assertion, three outcomes not two.
- [ ] Share target — receive links, text and images from other apps.
- [ ] Camera: photograph the finished plate.
- [ ] Cook mode: step through the method with ingredients pinned; rate at the
      end.
- [ ] Shopping mode: large tap targets, works with no signal.
- [ ] RevenueCat for cross-platform entitlements.
- [ ] TestFlight — **far earlier than feels comfortable.**

### What Phase 3 will hit that the list above does not say

Found at the Phase 2/3 checkpoint by reading the built code against these tasks.
Five dependencies, none of them Expo problems.

**Nothing issues a token to a device, and nothing can verify one there.** The HTTP
surface returns a signed entitlement token, and `authoriseToken` checks it — but
only where a public key is in hand. There is no distribution story for that key,
no refresh schedule, and nowhere on the device for a token to live. Offline
entitlement is the point of signing them, and the last mile does not exist. This
blocks the shopping mode's no-signal requirement, not just billing.

**Local SQLite has no row-level security.** ~~Decide deliberately whether the local
store is per-household or per-device, before the sync engine decides for you.~~
Answered: `docs/on-device.md` and decisions §20. One household per device, the file
is the boundary, and `family_id` still travels on every row so a foreign row is one
query away from being caught. What remains is building it.

**Camera has no write path.** The photo bucket deliberately has no client write
policy — imports are fetched and stored server-side. Photographing the plate needs
a storage write policy written from scratch, plus a decision about whether the
device uploads directly or posts to a route. And `photos.storage_path` assumes the
object already exists, which a photo taken offline does not — so this is the only
Phase 3 task needing both new SQL and a migration (`docs/on-device.md` §5).

**The share target receives a link for exactly the platforms that never resolve.**
Instagram and TikTok hand over a URL, and decisions §12 says reject those up
front. So the share-sheet path that a user will reach for most is the one ruled
out, and the routes that do work — screenshots and video files — are the ones
nothing implements yet. Tier 3 accepts images and Phase 4 owns video, so the share
target's real job is triage, not receiving. Build it as triage.

**`import_jobs` has a drain but no scheduler.** The runner claims work atomically
and is callable from a route; nothing calls it on a timer. A device that submits an
import and closes waits forever. Cron, a queue trigger, or a Supabase scheduled
function — the choice is small, its absence is not.

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

Load-bearing behaviour that nothing currently proves. **Ranked by how quietly it
fails, not by how much work it is** — a gap that throws is a gap that gets fixed
the day it matters, and a gap that returns a plausible wrong answer can sit in
production for a year. Anything that would fail loudly is at the bottom on
purpose.

Reviewed at the Phase 2/3 checkpoint. Two closed there; the rest carry forward.

### Fails silently, wrong answer looks right

1. ~~**`verify()` does not check expiry.**~~ Closed: `authoriseToken` pairs the
   signature check with the window and returns a union with no expired state.
   `verify()` keeps its narrow meaning, and there is a test pinning that it still
   accepts an expired token on its own.
2. ~~**Composite foreign keys tested on one table of seven.**~~ Closed, and it
   found two references that were single-column — `ratings.family_member_id` and
   `recipes.created_by`. `assert_rls_invariants()` now refuses any migration that
   adds a single-column reference between household tables.
3. **Nothing reaps orphaned photo objects.** An import that fetches and stores a
   photo, then fails or is abandoned at the review screen, leaves the object in
   the bucket with no `photos` row pointing at it. Nothing lists it, nothing bills
   for it visibly, and nothing deletes it. It accumulates. Storage cost is the
   symptom; the real problem is that an object with no row has no household, so
   it is outside every access rule that has been written.
4. **`assert_rls_invariants()` only runs if a migration remembers to call it.**
   It is the guard behind three separate invariants now, and its own enforcement
   is a convention. Two existing migrations legitimately skip it (they add no
   tables) which is exactly what makes an omission hard to spot by eye.
5. **`platform_spend_quota` being service-role-only was verified by hand.** If a
   grant slips, quota stops being server-authoritative and the failure is a
   number that is merely wrong.
6. **A public hostname can still resolve to a private address.** `normaliseUrl`
   refuses a client-supplied URL that *names* an internal host, which closes the
   direct cases. It cannot see DNS: `rebind.example.com → 127.0.0.1` passes. The
   check that would catch it inspects the address the socket actually connected to,
   which belongs in the `Fetcher` adapter — a custom lookup or agent, and the only
   remaining half of decisions §26's request-forgery finding.
7. ~~**`accounts` has an `accounts_update_self` policy and no matching grant.**~~
   Closed: the policy is dropped, so a future `grant update on accounts` fails
   closed rather than silently opening the table, and
   `assert_rls_invariants()` refuses any client write policy on a platform table.

### Fails loudly when it fails

8. **`registerDevice`'s revoked-device path.** Untested.
9. **The `child_has_no_login` constraint.** Untested. Violating it raises.
10. **Seed idempotency** was verified by hand — but the catalog round-trip test
    would fail loudly if a second seed duplicated rows. Downgraded from where it
    sat before.

### Known and accepted

11. **Quota double-charge window.** A crash between the spend and recording the
   job charges an import that never ran. One statement cannot span both. The
   household loses one import from an allowance of fifty; a reservation protocol
   costs more than the failure does.

**Closed:** the post-reset flake. It was two bugs, not one. Discovery gave up after
nine seconds and skipped the whole integration suite while reporting green — now
`test/global-setup.ts` waits once per run for both GoTrue and PostgREST to answer,
and a stack that is present but unreachable fails rather than skips. And the
forged-signature test flipped the last base64url character of a signature, which
decodes to the same bytes four times in sixty-four. Turbo also cached the `test`
task on source hashes, so three reproduction attempts were replays; `test` is no
longer cached.

---

## Working notes

**Order matters more than speed.** Phase 0 is the least satisfying and the
highest value. Resist skipping to UI.

**One task per session.** Each should be small enough to finish and verify.

**Stop at the open questions.** If a task requires Apple's billing rules or the
sync engine choice to be settled, say so rather than guessing —
`docs/decisions.md` lists them.
