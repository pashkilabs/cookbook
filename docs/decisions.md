# Decisions

Each entry records what was chosen, why, and **what would change the answer** —
so a future revisit is a check against reality rather than an argument from
memory.

---

## 1. TypeScript everywhere, pnpm + Turborepo monorepo

One language across web, native, server and shared logic. Beyond the usual
argument, this is the single biggest factor in how effectively an AI assistant
can refactor across the repo — connected types let it reason about the whole
system rather than one file.

*Would change if:* the media worker needs heavy CPU processing that Node handles
badly. Even then, isolate it as one service rather than splitting the codebase.

---

## 2. Web and native as separate UIs, sharing a core

Next.js for web, Expo for native, shared logic in `packages/core` and
`packages/platform-client`.

**React Native Web was rejected.** Writing the interface once sounds attractive,
but it would cost server-rendered public recipe pages — and those are the growth
loop. Someone texts a friend "you have to make this"; that link opens for a
person with no account, and it has to render properly and be indexable.

Cost: roughly 40–60% more UI work, not double, since core logic, API, backend
and design system are shared once. Ongoing tax is feature drift.

*Would change if:* the public sharing and search strategy is abandoned. Then web
becomes purely an app surface and RN Web wins.

---

## 3. Web ships first

No store review, so iteration is minutes not days. The prototype's React screens
port to web and nowhere else. Shared recipe pages start compounding early.

Accepted cost: App Store presence and true offline land in phase two. A
home-screen web app covers part of the gap.

*Would change if:* the share-target import path proves so much better than
paste-and-screenshot that the product is unusable without it. Watch this during
family use.

---

## 4. Native app, not a wrapped website

Decided once web was in scope. With a real web app, the reason to wrap one in a
native shell disappears, and the native prize — receiving shares directly from
Instagram and Facebook — needs genuine native integration.

---

## 5. Supabase Postgres, not a document store

The data is genuinely relational: households, members, recipes, ingredients,
plans, ratings. The ingredient catalog wants real text search. Row-level
security enforces household isolation as a database guarantee rather than
application logic you have to remember everywhere.

**Firebase rejected** — the document model fights shopping-list and meal-plan
queries.

---

## 6. Deterministic parsing before AI

Most established recipe sites publish machine-readable recipe data. Reading it
is free, instant, and more accurate than any model, because you're reading what
the site published rather than interpreting it.

This removes the majority of running cost *and* most failure modes. Combined
with caching by URL — a recipe that goes round Facebook is parsed once for the
entire user base — it matters more than model selection by a wide margin.

*Would change if:* structured recipe data stops being widely published. Watch
the tier-0 hit rate as a product metric.

---

## 7. US-hosted inference; open weights are not the cost story

Where a model was *trained* and where data is *processed* are different things.
Open weights run on US infrastructure send nothing abroad. But the policy chosen
is US-hosted only, and under that constraint the economics invert:

| Role | Model | Rough rate |
|---|---|---|
| Workhorse | GPT-5.6 Luna | $0.20 / $1.20 per 1M, cached input ~$0.02 |
| Fallback | GPT-OSS 120B (Together) | $0.15 / $0.60 |
| Escalation | Claude Haiku 4.5 → Sonnet 5 | on schema-validation failure |
| Vision | Gemini Flash-Lite or Claude Haiku | low volume, hardest input |
| Transcription | Groq Whisper-v3 (~$0.04/hr) | |

Once Chinese-origin models are excluded, the cheapest US closed models beat US
open weights on **both** quality and price. The open-source cost argument was
largely a Chinese-model argument.

At realistic volumes this is ~$1.10–1.70 per thousand imports — a rounding error
against subscription revenue. **The reason to run cheap models is tail abuse,
not the average:** one user importing 400 saved reels in a weekend.

*Would change if:* the policy relaxes, or the landscape shifts again — it moved
materially in six months. Re-benchmark quarterly. All of this sits behind one
provider interface so the model is a config value.

*Caveat worth remembering:* "no Chinese lineage" is harder to enforce than it
sounds — US-authored fine-tunes are frequently built on Chinese base weights.
The enforceable version of this policy is about data flow, not provenance.

---

## 8. Fair-use quota from day one

A flat subscription against variable AI cost is an unbounded liability. The
quota lives in the entitlement token. Generous enough that only abuse touches
it.

*Non-negotiable on timing:* adding a quota later is nearly impossible without
upsetting people.

### Where it is enforced

**In `public.platform_spend_quota`, service role only** — one database function
holding a row lock, doing the period rollover and the spend as a single indivisible
decision. Verified under twenty concurrent spends, and under twenty concurrent
spends that straddle a period boundary.

**The rollover is deliberately not a scheduled job.** A nightly reset and a spend
interleaving over the same row is exactly the race the function exists to avoid:
one of them works from a balance the other has already replaced, and afterwards the
numbers still look plausible. Rolling over as part of the spend means there is only
ever one writer — a counter whose period has elapsed is reset by whoever next tries
to use it. Nothing has to run on a timer, which is also one fewer thing to
monitor.

Details that were decided rather than fallen into:

- `periodDays` on the counter drives it. Absent means a **one-off** allowance: it
  renews once when `resetsAt` passes and then never again.
- A long gap advances by **whole periods until the deadline is in the future**, so a
  household that did not import for three months lands on the right date instead of
  three resets behind.
- The rollover is persisted **even when the spend is then refused**. Time passing is
  a fact about the counter, not about the request, and leaving it unrecorded would
  show a `used` figure from a period that has ended.
- The client mirrors the same logic in its in-memory store, on purpose. A fake that
  skipped the rollover would let the unit tests pass while the real thing behaved
  differently.

Still open: **the numbers themselves.** They are set at issuance and depend on the
free-tier question below. The mechanism does not depend on that answer; the numbers
do.

---

## 9. Entitlements as a signed token, degrading to read-only

You cannot call a licence server from a supermarket basement. Entitlements
travel on the device as a signed token with a validity window and a grace
period. After grace, the app degrades to **read-only, not locked** — a family
should never lose access to their own recipes because a card expired mid-shop.

### Where it is enforced

**In the row-level security policies, on writes only.** `private.household_can_write(family_id, app_key)`
is ANDed into the insert, update and delete policies of every household table, and
is **never referenced by a SELECT policy**.

That placement is the decision. Three options were on the table:

- *The seam's HTTP surface.* Rejected: it is exactly the "application logic you
  have to remember everywhere" that §5 rejected for household isolation. Every new
  mutating route would be a fresh chance to forget.
- *Route all writes through database functions.* Rejected: it means abandoning
  PostgREST for writes, an enormous change bought for nothing while Phase 2 is
  still unwritten.
- *An RLS predicate.* Chosen. Isolation is already a database guarantee; billing
  state belongs in the same place, for the same reason.

The property that makes this the right shape: because no SELECT policy consults
it, **there is no code path that could deny a read.** Read-only is the floor by
construction rather than by discipline. A migration self-check asserts that no
SELECT policy ever references the predicate, so adding one "for symmetry" breaks
`db reset` instead of quietly inventing the locked state this decision forbids.

Consequences worth knowing:

- An update by a lapsed household **fails loudly** (`42501`), so the API can say
  "you are read-only". A delete is refused **quietly** — zero rows — because
  DELETE has no `with check` clause to fail.
- The service role bypasses RLS, so entitlement issuance, webhooks and the import
  service keep working for a household that cannot write. That is correct: the
  server is the thing deciding.
- **`grace_until` became a column**, reversing the earlier choice to compute it in
  the client. Once the database enforces the window, the predicate and the token
  have to agree about when it closes, and a client constant plus a server constant
  that drift is worse than a column. It also makes extending one family's grace a
  support gesture rather than a deploy. `graceUntilFor` remains for issuance.
- A household with **no entitlement at all** cannot write. Absence is not an
  unmetered allowance.

---

## 10. Don't build the platform first

Ship the recipe app with a deliberately thin platform beneath it — auth, family,
one entitlement, billing. Let app #2 reveal what actually needs generalising.

What matters *now* is the seam, not the abstraction: the app must never reach
into platform tables directly. Get the boundary right and extraction later is
mechanical.

The recipe app will define the platform whether or not that's intended. Choose
its patterns as though every future app inherits them.

---

## 11. Use a sync engine; don't hand-roll

Postgres→SQLite replication, local database as the source of truth on device.
Last-write-wins per row is genuinely adequate: two people rarely edit the same
recipe in the same minute. Resist conflict-resolution theatre.

**Highest-risk dependency in the project.** Check maintenance health and funding
before committing — migrating sync engines mid-project is brutal.

*Revisited after building the schema.* The sync-readiness conventions held up:
UUID keys, `updated_at` by trigger, and readable tombstones are what every
candidate needs. But three things in `packages/db` may fight an engine, and they
were added for good reasons that a sync engine will not care about:

- **Composite foreign keys.** Child rows reference `(parent_id, family_id)`
  together, which is what keeps the denormalised tenant key honest. Row-by-row
  replication arriving out of order will violate them transiently, so the engine
  needs deferred constraints or a load path that disables them.
- **`ON DELETE CASCADE`.** A cascade on the server produces deletions the engine
  did not replicate and may not observe.
- **Partial unique indexes** (`where deleted_at is null`). An undelete arriving
  before its delete violates them transiently.

None of this changes the decision — hand-rolling replication is still worse. It
does mean **constraint handling belongs on the evaluation checklist** alongside
maintenance health, and that the schema may have to give something up. Better to
know which three things are negotiable than to discover it mid-migration.

---

## 12. Media ingested as files, not scraped from links

A reel splits its recipe across three places: narration carries the method,
on-screen text carries the amounts, the caption carries the title and often the
full list. Fusing all three beats any single source.

But the share sheet hands over a *link*, not a video. Pulling media from that
link server-side runs against the terms of service of all three platforms — a
real business risk for a paid product under a company name, and a maintenance
treadmill as platforms change defences.

**So: the user saves the video and shares the file.** Identical pipeline, one
extra tap, no scraping infrastructure. The same code also supports filming a
relative cooking, which for a family recipe app is arguably the better feature
and has no terms of service anywhere near it.

---

## 13. Grocery catalog as data

"Cream comes in half-pints, pints and quarts" was hardcoded in the prototype. As
a database table it can be corrected, extended, and eventually improved from
aggregate usage. This is what makes the shopping list get smarter over time
rather than frozen at whatever was typed once.

---

## 14. Eval scoring treats an absent field as `null`

**Reversed from the opposite rule**, which shipped with the harness and lasted
about an hour.

The original rule: a field missing from an extractor's output scored wrong even
where the hand-checked answer was `null`. Only an explicit `null` counted as an
answer. The reasoning was that "I looked, there is none" is worth more than
silence, because silence can't be told apart from a crash — and an extractor that
never emits a field would otherwise score full marks on every recipe that happens
to lack one.

That reasoning was about the wrong layer. Schema-constrained model output
routinely omits nulls, and once model extractors exist the adapter around the
model decides field presence, not the model. The harness would have been grading
our own wrapper code and calling it extraction quality. `undefined` is now
normalised to `null` at the adapter boundary before anything is compared.

The signal the old rule protected was real, so it moved to the aggregate: a field
never emitted anywhere in the fixture set produces one warning line in the report
header (`!! time was never emitted across 20 fixtures`) instead of N failures that
each look like a wrong answer. One line, not a diluted percentage.

*Would change if:* the product ever needs to distinguish "the source states no
time" from "extraction failed to read the time" — a review screen that flags the
second differently, say. That distinction can't be expressed in a two-state
field, so it would mean a third state in the extractor contract rather than a
return to grading presence. Absent that, this stays.

---

## 15. Entitlement tokens are Ed25519, and name no algorithm

Signed with Ed25519, addressed by key id, format
`pashki1.<keyId>.<payload>.<signature>`. Not a JWT.

Asymmetric so app #2's server can verify a platform-issued token holding only a
public key; a shared HMAC secret would mean everything that can verify can also
mint, and a leak would compromise every tenant. Key ids exist so a rotation can
actually complete — a verifier holds several public keys while tokens from the
retired one are still inside grace.

**No algorithm field, deliberately.** A token that names its own algorithm is how
JWT libraries end up accepting `alg: none` or checking an RSA signature with an
HMAC key. The verifier knows what it is.

*Would change if:* signing moves to a KMS or HSM that only offers other
algorithms, or a platform consumer cannot get an Ed25519 implementation. The
`TokenSigner` port already tolerates async for exactly that case.

---

## 16. Platform tables are read-only to clients; the seam needs the service role

Clients get `SELECT` on platform tables and no write path at all. Creating a
household, adding a member, registering a device and issuing an entitlement all go
through `packages/platform-client` on the service role, and quota spending is a
service-role-only database function.

This is the cheap half of enforcing decision §10 — the app cannot reach into
platform tables because it has no grant to. The other half is
`scripts/check-platform-tables.mjs`, which fails the build on a direct query.

**The cost, which is real:** the seam cannot run in a browser or an app bundle.
Web can call it server-side, but native needs HTTP routes in front of it, and
that work now sits in Phase 2 rather than appearing as a surprise in Phase 3.

*Would change if:* a client genuinely needs to write a platform table offline. The
answer then is probably a narrow RPC with its own policy rather than opening the
tables — the seam is the thing worth keeping, not the grant matrix.

---

## Unresolved

| Question | Why it blocks | Who can answer |
|---|---|---|
| Apple's outside-purchase rules | Could dictate the whole billing architecture | Apple's live guidelines + someone who ships subscription apps |
| Sync engine | Highest-risk dependency | Evaluation against current options |
| Copyright posture on imported photos and prose | Changes what you store and display | Someone who does this professionally |
| Free tier / trial / paid-only | Affects quota design and cost exposure | You |
