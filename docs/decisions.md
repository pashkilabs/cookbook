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

*Revisited after building it.* The metering is real and atomic — a conditional
`UPDATE` that refuses rather than exceeding, verified under concurrent spends. Two
things are not done: **nothing resets a counter** (`resetsAt` is stored, displayed,
and acted on by nobody, so a monthly allowance is currently a lifetime one), and
the numbers themselves are unset because they depend on the free-tier question
below. The mechanism does not depend on that answer; the numbers do.

---

## 9. Entitlements as a signed token, degrading to read-only

You cannot call a licence server from a supermarket basement. Entitlements
travel on the device as a signed token with a validity window and a grace
period. After grace, the app degrades to **read-only, not locked** — a family
should never lose access to their own recipes because a card expired mid-shop.

*Revisited after building it.* The decision stands, but it is **only half
implemented, and the missing half is the enforcing one.** `evaluateAccess` decides
the level and the client is expected to honour it. Nothing on the server does:
row-level security proves which household a row belongs to and never asks whether
that household is paid up, so a lapsed family can still write through the API.
Read-only is currently a UI convention.

Worth being precise about what that does and does not cost. The token being
offline-readable is right, and a device deciding its own level from a signed token
is right. What is missing is the server refusing writes once grace has passed, and
that has no hook in the schema today. It is the largest gap in Phase 1 and it is
tracked as a Phase 2 task rather than left implicit here.

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
