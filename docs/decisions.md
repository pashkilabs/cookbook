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

## 17. A visibility flag, not a share token

`recipes.visibility` is `private` (default) or `public`. Public means
**world-readable and indexable by `anon`**. There is no share token.

The two are different products, not two implementations of one:

| | Public flag | Share token |
|---|---|---|
| Who can read | anyone | whoever holds the link |
| Search engines | indexed — that is the point | must carry `noindex` |
| Discoverable | yes | no |
| Revocation | flip the flag | rotate the token, and the old link dies |

§2 rejected React Native Web specifically to keep server-rendered, **indexable**
public recipe pages, because that is the growth loop: someone texts a friend "you
have to make this", the link opens for a person with no account, and Google can
find it. That is the flag. A share token would satisfy the text-a-friend half and
none of the indexing half.

An unlisted share link is a reasonable future feature, and it was deliberately not
built now: it would mean designing rotation, revocation and leak semantics with no
consumer, and `visibility` is text rather than a boolean so `unlisted` can join it
without a type change.

**Enforced by RLS plus column grants together.** RLS decides which rows anon may
read (`visibility = 'public' and deleted_at is null`); column privileges decide
which columns. Both are needed, because a publishable row still carries household
data — `family_id` identifies the household, and `make_again` / `times_made` /
`created_by` are private signals about how it cooks. The consequence is that
`select *` as anon fails rather than silently returning a subset, which is the safe
direction.

Deleted recipes are excluded from public view even though tombstones stay readable
inside the household. That rule exists so a sync peer can observe a deletion; anon
is not syncing.

**Only the household's own photograph is public.** `photos.source = 'camera'` is
the family's picture of the finished plate, theirs to publish. An `'import'` photo
is the original blogger's, and republishing it world-readable is precisely what the
unresolved copyright question governs — so the default is the conservative subset
that does not need that question answered. Widening it is one migration once it is.

*Would change if:* the copyright posture lands somewhere that makes world-readable
publication of imported content untenable. Then `public` becomes reachable only for
recipes a household authored, and an unlisted token becomes the sharing mechanism
for everything else. The flag survives either way; what changes is who may set it.

---

### Reversed in exposure, not in decision (2026-08-14)

**The anon read surface is revoked until something renders a public recipe page.** Everything
above still stands: when the pages are built, they are built on a flag and not a token, and
migration `20260811090500` is the specification for putting it back.

What changed is not the reasoning, it is the exposure. `apps/web` is now deployed against a
hosted project on the public internet, so the anon path is reachable by anyone holding the
publishable key — which is in every client bundle by design. **Nothing renders those pages**, so
the surface was live for a feature with no users.

The specific cost is one this file already records as a trap: Postgres checks the new row of an
`UPDATE` against `SELECT` policies, so loosening a SELECT policy promotes the UPDATE policy from
redundant to load-bearing. §18 treats that promotion as an achievement, and it was — while
something was going to use it. Carrying it for an unbuilt feature is paying a risk and taking no
benefit.

Kept: `recipes.visibility`, because the column costs nothing and dropping it would discard whatever
anyone has already marked public; and `private.recipe_is_public()`, still used by the
`authenticated` policies.

**Not included, and worth a separate decision:** the `authenticated` `*_select_public_any`
policies — a signed-in stranger reading another household's public recipe. Those are what actually
promote the UPDATE policy, and revoking them would move `scripts/mutate-rls.sh`'s acceptance
criteria back to `masked`, which is undoing §18 rather than pausing §17. Left in place pending a
decision.

**Status: decided, migration written (`20260814090000_revoke_anon_reads.sql`), not applied.**
`scripts/mutate-rls.sh` and `packages/db/test/rls.test.ts` both still assert the old surface and
must change in the same commit. Blocked on the development machine having no working Docker, and
therefore no Postgres to prove any of it against.

*Would change if:* the public pages get built. Then this reverses again, deliberately, with
090500 as the text.

## 18. Publishing promotes the UPDATE policy from redundant to load-bearing

Recorded because it was predicted, then confirmed, and it will matter again.

While the `recipes` SELECT policy was household-only, it masked the UPDATE policy
completely: Postgres checks the new row of an `UPDATE` against SELECT policies, so
weakening UPDATE alone changed no observable behaviour. `scripts/mutate-rls.sh`
reported those two mutations as `masked` with a note that public pages would change
it.

Publishing loosened the SELECT policy — a signed-in person may read any household's
published recipe — and both mutations now report `caught`. The UPDATE policy is now
the only thing stopping a stranger editing a published recipe.

*The rule this leaves behind:* **any change that loosens a SELECT policy must be
followed by `test:mutate`, and any mutation that flips from `caught` to `masked` is
a regression, not a curiosity.** A masked mutation means some other policy is doing
the work and the one under test is unverified.

---

## 19. The method is a child table, and is not published

`recipe_steps` — one row per instruction, ordered by `position` — rather than a
`text[]` on `recipes`.

The array is simpler and was rejected on two counts:

- **Last-write-wins is per row** (§11). Two people editing different steps of the
  same recipe would conflict on a single array and one edit would vanish. A row per
  step lets last-write-wins resolve each independently, which is the behaviour §11
  assumes is adequate.
- **Cook mode is per-step** (Phase 3): a timer, a checked-off box, an ingredient
  pinned to step 4. Each needs a step to have an identity. An array element has
  none, so every one of those features would have started with this migration
  anyway.

It also matches `recipe_ingredients`, so both halves of a recipe have one shape.

**Steps are not readable by anon**, and that is a position rather than an omission.
An ingredient list is close to a list of facts; the method is the source's prose —
what §12 says not to reproduce, and the substance of the unresolved copyright
question. A public page shows ingredients, times and attribution, and links back
for the method. The migration asserts anon has no privilege on the table.

*Would change if:* the copyright posture lands somewhere that permits republishing
method text — for household-authored recipes it already would. Widening is a column
grant and one policy mirroring `recipe_ingredients`, and it should be a deliberate
act rather than a default.

---

## 20. One household per device, and the file is the boundary

A device holds exactly one household's data at a time. Switching households wipes
the local database and re-syncs.

SQLite has no row-level security and never will, so a device holding two households
would need `where family_id = ?` applied by application code on every read, forever,
with nothing checking it — the "logic you have to remember everywhere" that §5
rejected for this exact problem on the server. One household needs no predicate,
because there is no other row to leak. **Absence is the only enforcement that
cannot be forgotten.**

The cost is real and falls on real people: a caregiver, a second family, an adult in
two households re-syncs on every switch. It is bounded by one household's data,
which is small, and it is a cost to a few against a leak risk carried by everyone.

`family_id` still travels on every synced row even though the file makes it
redundant, because it turns "does this file contain a foreign row" into one query
per table — the on-device analogue of `assert_rls_invariants()`, and the only thing
that can catch a sync engine's bug rather than trusting it. See `docs/on-device.md`.

*Would change if:* real users hit the switching cost often enough to matter. The
upgrade is one database file per household with the *file* still the boundary —
never two households in one file, which is the version that cannot be made safe
later.

---

## 21. A device holds household rows; reference data and the roster arrive out of band

Nine tables sync — `recipes`, `recipe_ingredients`, `recipe_steps`, `ratings`,
`meal_plans`, `plan_entries`, `shortlist_entries`, `pantry_items`, `photos`. Both
`family_id` and `deleted_at` are necessary to be syncable at all: no `family_id`
means foreign rows cannot be detected, no `deleted_at` means a deletion cannot reach
a device in a form it can see.

Three things a device needs are deliberately **not** in the sync stream:

- **The grocery catalog** is a versioned snapshot over HTTP, cached locally, with a
  copy bundled as a floor. It is identical for every household, changes on deploy
  rather than on user action, and has no `family_id` — syncing it would make every
  household pay per-row replication for the same 152 rows and would break the
  invariant that every synced row carries a household.
- **The family roster** arrives inside the entitlement token, which already carries
  `members` with display names and `isChild` only. This is why no platform table is
  replicated to a device at all: the two things a device needs from them — who is in
  the household, and what it may do — both travel in the token.
- **Photo bytes** come from the CDN into a per-household cache directory mirroring
  `storage_path`. Blobs in the sync stream cost every device bandwidth for images
  most will never open.

`import_cache` must never reach a device: it belongs to nobody, holds other
households' scraped pages, has no `family_id` and is unbounded. `import_jobs` stays
server-side and is polled, because it holds raw import payloads that a device has no
use for once the review screen is done.

*Would change if:* the catalog grows large enough that a snapshot is a bad download,
which argues for delta fetching rather than for syncing it. Or if the roster needs
to change without a token refresh — for instance if members become editable offline,
which would make it household data rather than platform data, and a bigger decision
than this one.

---

## 22. The on-device entitlement check is UX; the server is the enforcement

The token lives in the OS keystore, refreshes on foreground and whenever
`shouldRenew` is set, and is re-fetched **before** access is re-evaluated on
reconnect so a stale token never causes a refusal a fetch would have avoided.

The token is not a credential. It cannot write to the server — server writes carry
the user's Supabase JWT through RLS, where `private.household_can_write()` re-checks
`entitlements`. A rooted device can therefore grant itself local writes and the
server will still refuse them, which means **the local check exists to keep the UI
honest, not to keep anyone out.** Do not build attestation for a check whose failure
mode is an optimistic screen.

What that buys is permission to make the offline behaviour generous:

- **Grace is the connectivity budget, not a billing courtesy.** A failed card is
  fixed in hours; seven days is a holiday with bad signal. That is what the window
  is sized for.
- **Read-only never touches reading, cook mode, or shopping mode** — including
  ticking items off, which is ephemeral device state rather than household data and
  is not gated at all. Shopping mode works with no signal and no valid token.
- **Refusal happens at one local write path**, not at each call site. That choke
  point is where the predicate we cannot express as a policy lives.
- **Queued writes are never discarded.** An outbox entry made while the token was
  valid syncs on reconnect; if the household really has lapsed the server answers
  `42501` and the app says so then. Destroying someone's work to guess at a billing
  state we cannot observe offline is worse than syncing it and being told no.
- **Unverifiable is read-only, not invalid.** An unknown key id — a rotation the
  device slept through — degrades and triggers a key refresh. §9's floor covers our
  own failures too, not only expiry.

*Would change if:* a token ever gates something the server does not re-check. Then
the local check becomes enforcement, and the keystore, the threat model in §23 and
this whole decision need revisiting together.

---

## 23. Verifying keys are published and refreshed, never only bundled

`GET /keys` on the seam: unauthenticated, cacheable, every currently-valid public
key with its id. A snapshot ships with the app as a floor; the fetched set is
persisted and wins.

A key that cannot be replaced cannot be rotated, which would make the key ids in
§15 decorative. Unauthenticated because public keys are public, and because a device
that cannot verify its token is one we want fetching keys rather than blocked behind
the thing it is trying to check.

**Publish before signing.** A new key appears in `/keys` at least
`token lifetime + grace + key staleness` — about 45 days — before it signs anything,
and a retired key stays published until every token it signed is past grace.
Rotation that skips the overlap turns every offline device read-only. This is the
operational rule with teeth.

**The threat model, stated so this is not over-built:** the list is served over TLS
from our own domain and is not itself signed. Forging it would let someone mint a
token their own device accepts, granting local writes the server refuses. So key
distribution needs integrity against *accidents* — a stale bundle, a botched
rotation, a CDN holding a retired key — not against an adversary with nothing to
win.

*Would change if:* §22 changes, or a platform consumer verifies tokens somewhere the
server does not re-check the entitlement. Then the key list needs its own signature
and a root key to sign it with.

---

## 24. Sync engine: six hard criteria, four ordered concessions

§11 said constraint handling belongs on the evaluation checklist. This is that
checklist, and the split between what is negotiable and what is not is the decision.

**Disqualifying, not weighed:**

1. `family_id` reaches the device on every synced row.
2. `updated_at` is applied verbatim from the server, never rewritten locally — a
   local trigger firing on replicated rows makes last-write-wins a function of
   device clocks, which is the assumption §11 rests on.
3. Deletions replicate as something a device can observe: our tombstones, or hard
   deletes the engine reports.
4. Sync can be scoped to one household.
5. Sync authenticates as the user, with server-side rules. No shared key, no
   client-declared scope.
6. A local write is durable before it is acknowledged.
7. **A deferred server call survives being offline, not only a replicated row write.**
   See below — this is the criterion most likely to be discovered late.

**On criterion 7 — the outbox is two mechanisms wearing one name.**

`docs/on-device.md` describes an outbox and means *writes to synced tables*: a rating made
on a train replicates when signal returns, and the engine owns that. The second mechanism
has no design and is not the same thing. **Queueing an import is an HTTP call to a table
the device deliberately does not hold** — `import_jobs` is excluded from the synced set on
purpose (§20, on-device §4), because syncing raw import payloads to every device forever to
drive a status spinner is a bad trade. That reasoning is still right.

What follows from it is that the share target — the feature most likely to be used away from
signal, since sharing a link is what people do while browsing on a phone — has nowhere to put
the link. It cannot write it to a synced table, because there isn't one. It cannot call the
server, because there is no server.

Two shapes answer it, and they are not equally cheap:

- **A local queue of deferred operations**, drained on reconnect, alongside the engine's own
  outbox. It works with any engine and is ours to build and get wrong — retries, idempotency,
  ordering against replicated writes, and what a person sees for an import that has been
  pending for two days.
- **A synced table the device may write**, an outbox in the schema rather than in the client,
  which the server drains. This costs a table and puts the engine's replication in charge of
  durability and retry, which is the thing it is good at. It also means the queue submission
  path stops being HTTP-shaped, which changes `POST /api/import/batch`.

This is a **selection criterion**, not an implementation detail: some engines make the second
shape natural and some make it awkward, and discovering which after choosing one is how a
six-month detour starts. It is listed here rather than in on-device.md because the engine
decision is where it becomes expensive.

**Conceded, in this order:** local foreign keys first (the server holds the
invariant and the on-device assertion catches the pathological case); then local
partial unique indexes (an undelete arriving before its delete is worse than briefly
allowing two "one per week" plans — the UI picks by highest `updated_at`, then lowest
`id`); then `ON DELETE CASCADE`, which is server behaviour; and last, reluctantly,
local `CHECK` constraints, whose loss means the local store is not a schema we own.

**One consequence that is not free**, and criterion 3 has a second half because of
it: cascades hard-delete children with no `deleted_at`. See *Open: cascade deletions
and tombstones* below — it is stated as a question rather than answered here,
because the answer depends on the engine and guessing now would just be a guess with
a section number.

*Would change if:* an engine fails one criterion but is otherwise so far ahead that
the criterion is worth re-examining. Re-examining is allowed; conceding quietly
during a migration is what this list exists to prevent.

---

## 27. Provisioning happens at first confirmed sign-in

An unconfirmed account gets nothing. No `accounts` row, no household, no membership — sign-up
asks GoTrue for an unconfirmed user and returns.

The alternative was to leave provisioning at sign-up and gate it, and that collapses on
inspection: at sign-up nothing is confirmed yet, by definition, so "gated at sign-up" means
"never runs at sign-up". The only real question was where it moves to.

**Why it has to move.** An unconfirmed account is a *claim* on an address, not ownership of
one. Provisioning at sign-up let anybody spend somebody else's address on a household they own
— `families.owner_account_id` is a real relationship, and `accounts.email` would fill with
addresses nobody had verified. The household is the first durable thing in this system; it
should not exist on an unproven claim.

**What makes it cheap** is that `provisionHousehold` was already idempotent (§16's descendant).
Every confirmed sign-in can call it and only the first does work, so there is no
"have-I-provisioned" flag to keep and no coordination between the confirmation path and the
sign-in path. Both call the same function; the second is a read.

The household name and display name are collected at sign-up and carried on the auth user's
`user_metadata` until they are needed. Metadata is user-writable, which is acceptable for
exactly this: the worst somebody can do is choose a different name for their own household.

Two consequences worth stating:

- **A confirmed account with no household is a legitimate, recoverable state.** If provisioning
  fails after confirmation, signing in completes it. The UI says so rather than pretending it
  cannot happen.
- **The gate is checked even where it should be unreachable.** GoTrue will not issue a session
  for an unconfirmed account, so `lib/provisioning.ts` refusing one should never fire — which
  is why it is tested with a hand-signed token that the auth server accepts. A guard nothing
  exercises is a guard nobody knows works.

*Would change if:* a flow appears where somebody is legitimately known before they confirm —
an invitation to an existing household, say, where the household already exists and the new
member is being added to it. That is additive rather than a reversal: the household is not
being created on an unproven claim.

---

## 25. A photo names its path before its bytes exist, and cannot name another household's

`photos.storage_path` stays NOT NULL. `upload_state` is `pending | stored`, defaulting
to `stored`.

A photograph taken with no signal has a row and local bytes and no object. The
alternative was a nullable path, and it was rejected: the path is derivable at capture
from `family_id` and a locally minted uuid, so nothing waits on the server to assign
it, and a null would be describing a *state* through a missing fact. It would also
drop NOT NULL for every row — including imports, where the invariant genuinely holds —
to express a condition affecting some. A final path from the moment of capture means a
second device knows where the bytes will be before they arrive, and the object becomes
readable the instant it lands with no row update in between.

The state deliberately does **not** appear in the storage read policies. Between an
upload completing and the row being updated, a policy checking `upload_state` would
deny an object that exists. The path authorises; the state is for the uploader. A
migration self-check asserts no storage policy references it.

### The bug found while checking this

The storage read policies resolve access by finding a `photos` row whose
`storage_path` equals the object name — a deliberate choice in 090700, so that a
renamed path convention cannot leave a policy matching the old shape. The cost of it
is that **the row is authoritative about which object it names, and clients write
rows.** Nothing tied a row's path to its own household.

So a household could insert a `photos` row naming another household's object and
inherit read access to it. Verified end to end: denied, claim accepted, then read.
With `source = 'camera'` on a published recipe it also made another household's
private photograph world-readable to `anon`.

Two constraints close it, and they go on the row rather than in the policy:

- `check (storage_path like family_id::text || '/%')` — a row can only name a path
  inside its own household's folder.
- `unique (storage_path)` — one object, one row. Otherwise deleting one row leaves the
  object authorised by another, and a row claiming an import's path with
  `source = 'camera'` would publish the blogger's photograph.

**Why a constraint and not a policy.** Parsing the path inside a policy is exactly
what 090700 rejected, and rightly: a convention encoded in a policy is a second source
of truth that keeps matching the old shape after the convention moves. A CHECK is
enforced on write, so if the convention changes, the next insert fails loudly instead
of a policy quietly authorising the wrong object. The policy still consults the row —
the row is now worth consulting.

*Would change if:* paths stop being derivable at capture — a storage provider that
assigns its own object keys would force the nullable-path shape, and the check
constraint with it. Or if the path convention needs to change, which is now a
migration rather than a rename, and that is the intended cost.

---

## 26. A client writes columns, not tables

Client roles hold **column-level** INSERT and UPDATE on household tables, never
table-wide, and no DELETE at all.

This came out of an audit of what a client can assert that RLS does not check, prompted
by the `photos.storage_path` hole having survived several sessions. The audit's premise
turned out to be the finding: **RLS decides which rows a caller may write and says
nothing about which columns.** Table-wide grants meant every column of a writable row
was client-assertable, and four different things were reachable that way — quota
accounting, queue control, photo provenance, and the timestamps sync resolves conflicts
with. None of them were policy failures. Every policy was correct.

So the rule is now: a client may write the columns that represent a user's decisions.
Everything the server decides — state machines, counters, provenance, accounting,
identity, timestamps — is granted to the service role only.

Why grants rather than triggers, which could also express this: column privileges are
checked *before* row-level security, are visible in `information_schema`, and cannot be
bypassed by a code path that forgot to consult something. A trigger inspecting
`auth.role()` would work and would be one more thing to be correct. The narrower guard
that needs no logic wins.

Two invariants in `private.assert_rls_invariants()` keep it true for tables that do not
exist yet: no client role may write `created_at` or `updated_at` on a table carrying
`family_id`, and no client role may hold DELETE on a table carrying `deleted_at`.

**Deletion is a tombstone.** That follows from architecture §5 rather than from security:
a hard-deleted row is precisely the row a peer cannot distinguish from one that never
synced. It has a happy side effect — decisions §9 recorded that a lapsed household's
DELETE was refused *quietly*, zero rows, because DELETE has no `with check` clause.
Routed through an UPDATE to `deleted_at`, the entitlement predicate applies and the
refusal is loud like every other write. The wart is retired rather than documented.

*Would change if:* a table appears whose whole content is server-assigned, where the
right answer is no client write grant at all rather than a narrower one. Or if the column
lists start drifting from what the app needs — the failure mode of this decision is a
grant that quietly widens during a migration, which is why both halves are asserted
rather than merely written down here.

---

## 28. Display follows the household, not the recipe and not the catalog

A household has a measurement system — `families.measurement_system`, `us` or `metric`,
defaulting to `us` — and every number it reads is in that system.

Found by running the shopping list against a real week: a recipe typed as `300 g tagliatelle`
came back as **11 oz**, and `1 litre chicken stock` left `1⅝ cup` spare. `formatWeight` is
imperial above 25 g, `formatVolume` never emits millilitres, and the catalog is American —
cremini, russet, sticks of butter, 5 lb bags. Internally consistent, and wrong for the household
that typed it.

Three candidates for the authority, and two of them fail on the same case:

- *The recipe's own units.* Rejected. A household types "300 g pasta" from one source and "2 cups
  rice" from another, and a list that mixes them is harder to shop from than either. The same
  argument kills per-ingredient units.
- *The catalog's units.* Rejected for the same reason once the catalog is more than one market's:
  the household would read whatever the shop it is not standing in happens to sell.
- **The household.** One setting, one consistent list, whatever the recipes said.

### Package sizes are per market, not per label

This is the part that reaches into the catalog, which is why it is being done now rather than
after Phase 3. A pint is 473 ml and a metric carton is 500 — the sizes *differ*, they are not one
size with two names. So `grocery_packages` carries a `system`, uniqueness became
`(ingredient_id, system, label)`, and `choosePackages` must never see two markets at once or it
will offer a pint and a 500 ml carton for the same purchase.

**Metric coverage is partial and stated rather than implied.** `METRIC_PACKAGES` covers 43 of the
55 catalog items with sizes a British or European shop actually stocks;
`catalogItemsFromRows` falls back to the US rows for the rest, explicitly, because an item with no
packages is one a household cannot be told how to buy. Guessing at the remaining twelve would put
invented numbers into the one part of the system that has to be right.

### The thresholds are a judgement, not a conversion

`formatWeight`, `formatVolume` and `formatMeasure` take the system, and `consolidate` threads it
through every display it produces. Where the two systems change unit is chosen, not derived:

| | metric | US |
|---|---|---|
| weight | grams below 1000, kilograms above — "500 g", never "0.5 kg" | ounces from 25 g, pounds from ~408 g |
| volume | millilitres below 1000, litres above — "250 ml", never "0.25 l" | tsp, tbsp, cups from 115 ml, quarts, gallons |
| above the threshold | a decimal: "1.5 kg" | a fraction: "1½ qt" |
| below it | rounded whole: "247 g", "237 ml" | as the US boundaries fall |

A cook writes 500 g and 250 ml, so metric changes unit only at 1000 rather than wherever the
number divides tidily. Metric shows a decimal because that is how it is written down, while a
fraction is how a cup is spoken. Small metric volumes stay in millilitres rather than becoming
teaspoons: on a shopping list these are totals, not instructions, and "15 ml" is unambiguous where
"1 tbsp" invites the question of whose tablespoon.

Counts are untouched in both — three onions are three onions anywhere.

**A US household's output is unchanged**, asserted directly rather than inferred from the older
tests passing: every formatter renders identically whether the system is omitted or stated as
`us`, and `consolidate` produces a deep-equal result either way.

*Would change if:* a household needs two systems at once — one adult cooking in cups while the
other shops in grams. The setting would move from the household to the member, which is a bigger
change than it sounds: `family_members` has no login for children, so "whose preference" stops
having one answer.

---

## 29. "As written" means the parse, and the parse is rendered as a recipe would write it

The split display — *"Tuesday takes 1 cup, Friday takes ½ cup"* — said **"takes 2 clove"**, because
`formatAsWritten` printed the canonical unit verbatim.

Two readings of "as written" were available, and one of them is not:

- *The source text.* **Not available.** `recipe_ingredients` stores the amount, the unit, the item
  and the note; the original keystrokes are gone by the time anything renders. `ParsedIngredient`
  carries a `raw` field, but in the product that field holds a line the app *rebuilt* from the
  stored columns — so displaying it would show a reconstruction while claiming fidelity.
- **The parse, rendered the way a recipe would write it.** Chosen. Word units inflect (`2 cloves`,
  `1½ cups`), symbols never do (`250 g`, `2 tbsp`).

The absence of stored text made the decision, and it is worth being explicit that it did: had the
source been kept, showing it would have been the better answer, because the split display exists
to let somebody check a number against the recipe in front of them.

**Every plural emitted is one the parser accepts.** The recipe editor rebuilds its lines from these
strings and re-parses them on save, so a plural we produced but `canonicalUnit` could not read
would quietly drop a unit — a cup becoming a bare number. There is a round-trip test for it.

*Would change if:* the original line gets stored. That is a column on `recipe_ingredients` and it
has an independent reason to exist — the import review screen wants to show what the model was
given alongside what it made of it, and an eval fixture wants the same. If it lands, "as written"
should become the text, and this decision reverses.

---

## 30. Soft-delete propagation lives in a database trigger

Deleting a recipe tombstones its ingredients, steps, ratings, photos, shortlist entries and plan
entries — in `private.propagate_soft_delete`, fired by a trigger, not in the delete route.

This closed a live bug. Clients hold no `DELETE` privilege (§26), so every deletion in the product
is an `UPDATE` setting `deleted_at`, and **`ON DELETE CASCADE` does not fire on an UPDATE**. A
tombstoned recipe kept its plan entries: still on the planner, still buying ingredients on the
shopping list.

### Why not the route

The route is where somebody would look for it, and a trigger is invisible from there. That cost is
real and it is paid on purpose, because of what Phase 3 does:

**A sync engine writes to Postgres directly.** A device deleting a recipe offline replicates
`deleted_at` into `recipes` without going near a route handler, so propagation written there would
simply not happen — and the household would meet the same bug again from a phone. No amount of
care in the application layer covers a writer that does not call it.

Two smaller reasons agree. A trigger cannot be forgotten by a future caller — the import service,
an admin script, a repair query are all doors the route is not. And it runs inside the same
statement as the parent update, so a peer observes one consistent set of tombstones rather than a
parent that arrived ahead of its children.

The invisibility is paid down where it bites: `assert_rls_invariants` fails if a new child table
has no propagation, and the delete route carries a comment pointing here.

### What a device sees

Children get `deleted_at` set to **the parent's exact timestamp**, and `set_updated_at` bumps
`updated_at` as usual. So a peer sees ordinary row updates it already knows how to replicate — it
is *told* the children went rather than expected to infer it (architecture §5).

### Two modes, mirroring the foreign keys

`tombstone` for everything that cascades on a hard delete. `nullify` for `recipes.created_by`,
which is `ON DELETE SET NULL`: a person leaving takes their ratings with them — a score attributed
to nobody is worse than no score — but not the recipes they wrote, which are still dinner.

`families` and `accounts` are exempt, both because deleting one is teardown rather than editing. A
household going away is a device wipe (§20) and a hard delete that cascades, not a million
tombstones for a household that no longer exists.

### The reverse

**Nothing in the product restores a soft-deleted row.** No screen offers it, no route sets
`deleted_at` back to null; the only undelete today is a hand-written statement. This is recorded
because an undelete arriving later would need the question settled anyway, and settling it now
costs nothing.

A restore trigger returns exactly the children whose `deleted_at` equals the parent's — the ones
that went *because* it went. A rating deleted on its own three weeks earlier stays deleted, which
is what somebody restoring a recipe wants. That is the whole reason children take the parent's
timestamp rather than their own `now()`.

`nullify` has no reverse: the old `created_by` is gone, so a restored member does not regain
authorship. Stated rather than left half-working.

*Would change if:* propagation becomes expensive enough to matter — a household with thousands of
rows under one parent — at which point the answer is a background job and a different set of
trade-offs, not moving it back into the route.

---

## 31. The batch runner is triggered by the app, and production needs a worker

**Decided.** `POST /api/import/drain` claims and runs a few jobs per call, and the batch screen
calls it in a loop while a person is on the page. That is what makes the queue reachable now; it
is not what it should be.

The queue itself was always the deployable half. `import_claim_next_job` is `FOR UPDATE SKIP
LOCKED` with a 300-second lease, so concurrent workers never take the same row and a worker that
dies mid-job returns its job to the pool. None of that assumes who calls it. What is missing is
only the *caller*.

Triggering from the app buys the whole feature at the cost of three properties:

- **A request timeout bounds the batch.** Hence the slicing — three jobs per call, and the screen
  loops — rather than one call that drains twenty and risks being cut off at the platform's limit.
- **Closing the tab pauses the batch.** Nothing is lost: the rows are in the database and
  reopening the page carries on. But a person who submits and leaves gets nothing until they come
  back, which is precisely the case a share target from a phone will produce.
- **Nothing reclaims a lease when no one is looking.** The reclaim is real, and it only fires when
  something calls `claim`. A job whose worker died stays `running` until the next drain.

**What production needs**, in the order it matters:

1. **A scheduler.** Supabase's `pg_cron` calling an Edge Function, or a container on a timer, or
   a queue trigger. Small choice; its absence is the entire gap.
2. **Concurrency.** The drain is strictly serial: measured at ~0.9 s per job median and 2.8 s at
   worst, so twenty links is roughly twenty seconds of wall clock for work that is almost entirely
   waiting on other people's servers. Four workers is a four-fold improvement for no cleverness,
   and `SKIP LOCKED` already permits it.
3. **Fairness.** `import_claim_next_job` orders by `created_at` across every household, so one
   household pasting fifty links delays everyone behind them. FIFO is right until it is not; the
   fix is claiming round-robin by `family_id`, and it is not needed until there is a second
   household with a batch.
4. **A reaper for abandoned reviews.** A job left in `review` holds a stored photo object that no
   `photos` row points at, so nothing can read it and nothing deletes it.

*Would change if:* the drain moves to a deployed worker, at which point the route stays as the
manual override — "run my batch now" — rather than being deleted.

---

## 32. Quota is charged when a result is recorded, not when a job is submitted

**Reversed.** This section first said the opposite, and the original argument is kept below
because it was sound — it lost to a measurement, not to a better argument, and that is the part
worth being able to find later.

### What it says now

A job is charged at the moment its outcome is recorded, in the same statement, by
`import_finish_job` (migration 092000). A failure charges nothing. A cache hit charges nothing. A
success charges exactly one, and `quota_consumed_at` means a job finished twice — reclaimed after
its lease expired — pays once.

There is no refund path and there is no race, because there is no window: spending the allowance
and writing `status = 'review'` are one transaction. A refund would have been a second write that
can fail on its own, and a refund racing a concurrent spend is precisely the read-then-write that
`platform_spend_quota` exists to avoid.

A success the household cannot pay for is recorded as **failed**, not handed over free. The meter
is the only thing between an allowance and ignoring it.

### What it said before, and why it lost

The original reasoning: **the fetch is the cost**. The request goes out, the bytes come back, and
a failure is not free to produce. A meter that charges only for successes can be driven
indefinitely by anything that fails.

That is still true. What defeated it is how often "anything that fails" happens. On a deliberately
messy batch of twenty-two pasted links, fifteen reached the queue and **ten of those failed to
fetch** — HTTP 402, 403 and 404 from bot-blocking CDNs, paywalls and link rot. Two thirds of the
household's allowance bought nothing.

That is not an adversary; it is Tuesday. Somebody who pastes twenty saved links, receives five
recipes and is billed for fifteen does not conclude that the recipe web is hostile. They conclude
the product is broken, and they are not wrong to. A fetch that never reached a page cost us
almost nothing, and charging for it defends a boundary that abuse would reach long before an
ordinary household did.

### What it costs

Charging late means the work happens before anyone asks whether it can be paid for: an
out-of-allowance household still causes a page fetch, and is refused afterwards. That is a real
cost and it is accepted deliberately — it is bounded by the allowance being finite, and the
alternative is the pre-flight check this section just removed. There is a test asserting the fetch
happens, so the cost is recorded rather than forgotten.

*Would change if:* failed imports become a way to consume real money — a tier that calls a model
before it knows the extraction succeeded, say. The fix then is charging at the point the expensive
thing starts, not returning to charging on submission.

---

## 33. The shared cache carries the source image URL, never a storage path

**Decided.** `import_cache` is keyed by URL hash and belongs to nobody: one row serves every
household that ever imports that page. A cache hit now returns the same photograph a miss would,
by carrying the **source** image URL — a public address on the original site, already part of the
extracted recipe — and re-fetching it into the requesting household's own storage.

### Why not the stored object

The table had a `photo_path` column for exactly this, and it is dropped in migration 092000. A
storage path here is `<family_id>/<uuid>.jpg`: one household's object, handed to whoever hits the
cache next. Nothing ever wrote it, which is the only reason this is a dropped column rather than
an incident.

It would not have leaked bytes. Every read policy on `recipe-photos` resolves through a `photos`
row, so a second household holding that path could not read it, and `photos_path_in_household`
would refuse the insert that tried to claim it. But a cross-tenant reference that fails a
constraint check is still a cross-tenant reference, and a shared table holding one household's
identifiers is the thing architecture §11 exists to prevent. The cache holds extraction and
nothing about who asked for it.

### Why not a shared copy of the bytes

A single canonical object in a shared bucket would save the re-fetch. It was rejected on two
counts. It needs its own bucket, its own access rules and its own lifecycle — a second storage
model beside the per-household one, for a saving of one image request. And the copyright posture
on imported photographs is an open question: each household holding what it fetched from the
publisher is a materially weaker claim than Pashki holding one copy and serving it to everybody.

### Why this was worth fixing now

The failure mode got worse as the product succeeded. The better the shared cache works — the more
households importing the same link that went round a group chat — the more recipes would have
arrived with no picture. A gap that widens with adoption does not wait.

An image that has since been taken down simply yields no photo; a missing image was never a failed
import. The cost is one image request per cache hit, measured at roughly 0.3 s.

*Would change if:* re-fetching starts being refused at scale — a publisher rate-limiting us for
requesting the same image on behalf of a thousand households — at which point the answer is a
shared object with the copyright question settled first, not a household path in a shared row.

---

## 34. Hosted auth sends through Resend, from a domain we own

**Decided.** Confirmation and recovery mail goes out through Resend on `smtp.resend.com:465`,
from `noreply@pashki.com`, at 100 emails an hour. Configured by
`pnpm --filter @pashki/db set:smtp` rather than by clicking, for the same reason `check:parity`
exists: configuration nobody can review is configuration nobody notices drifting.

### What the default was

Supabase's built-in sender is **two emails per hour for the entire project** — not per user, not
per address. That is enough to test a signup once and nothing else. The failure is quiet in the
worst way: the account is created, the send is refused afterwards, and the person sits looking at
an inbox with no error anywhere to explain it. Public signup could not open on that, and the fact
that development never noticed is exactly the point — one developer testing one flow never
reaches the second email.

### Why Resend

3,000 a month free covers every user this product will have before it has revenue, SMTP is a
hostname and an API key rather than a service integration, and domain verification is three DNS
records. Postmark has the better transactional reputation and the confirmation email is the one
that must not land in spam — worth revisiting if delivery disappoints, and cheap to revisit,
because the seam is six settings behind one script. SES is cheapest at scale and its sandbox
would have to be escaped by a support ticket before the first stranger could register.

### Why 100 an hour and not more

A rate limit is also the blast radius of a signup loop. 100/hour is far above any honest early
usage and low enough that a runaway costs an apology rather than a provider suspension. Raising
it later is one number; explaining an account suspension is not.

### What this does not fix

`site_url` on the hosted project is still `http://localhost:3000`, and GoTrue builds the link in
the email from it. So mail now **sends and is delivered** — proved end to end, Resend reporting
`delivered` for a real signup — and a stranger receiving it would click through to their own
machine. Public signup needs the web app deployed and `site_url` plus `uri_allow_list` pointed at
that domain. Sending was the blocker that could be removed today; it was not the only one.

*Would change if:* deliverability disappoints, or volume outgrows the free tier. Both are a
different value of `PASHKI_SMTP_HOST` and one script run.

---

## 35. The queue is drained by pg_cron calling the app, not by a worker

**Built** (migration `20260814092000`). Recorded as decided-and-unbuilt while the development
machine had no working Docker; the reasoning below is unchanged, and the measurements at the foot
are from the built thing.

`import_jobs` is drained only while somebody has the batch screen open (§31). Close the tab and
queued jobs sit there. The fix is a caller on a timer; the question was which caller.

### pg_cron + pg_net, calling `/api/import/drain`

A scheduled SQL job probes the queue and, when there is work, `net.http_post`s to the route the
batch screen already calls. **It adds a caller, not a second implementation** — the drained path
stays the one that has been measured, and the atomic claim is untouched.

The route needs a machine-callable door: it authenticates a signed-in household today, and a cron
tick has no session. A shared secret in a header, held in Supabase Vault rather than in a
migration, keeps it out of git.

### Why not a Supabase Edge Function

Edge Functions are Deno. The runner's `storePhoto` goes through **sharp, a native Node addon**, so
the function could not store a photograph — it would have to drop photos from queued imports or
reimplement resizing in a second place. That is a lot of new surface to avoid one HTTP hop, and
the surface would be exactly the part of the pipeline that already has the most edge cases
(orientation, EXIF stripping, format sniffing).

### Why not Vercel Cron

The project is on Hobby, where **cron fires once a day**. A person waiting on twenty pasted links
cannot wait until tomorrow. This becomes viable on Pro and is worth revisiting then — it would
remove pg_net and the shared secret entirely, since a Vercel cron request is already inside the
deployment.

### Conditional dispatch: an idle queue never leaves the database

The tick does **not** call out unconditionally. It first asks whether anything is claimable:

```sql
select exists (
  select 1 from public.import_jobs
  where deleted_at is null
    and (status = 'queued'
         or (status = 'running' and claimed_at < now() - interval '300 seconds'))
)
```

That predicate is deliberately the same one `import_claim_next_job` selects on, **expired leases
included**. Two things follow. A job whose worker died is not merely reclaimable in principle —
it is what wakes the scheduler up, so the 300-second lease is exercised by the normal path rather
than by an operator noticing. And the reclaim cannot rot, because the only thing that triggers a
drain is the same condition that makes a claim succeed.

The cost argument is the reason for the shape. A scheduler that POSTs every minute regardless
spends 1,440 HTTP calls and 1,440 serverless invocations a day to discover, over and over, that
nobody has imported anything — a real bill with no users behind it. Probing first makes an idle
minute one indexed lookup on `import_jobs_queue`, an index that already exists for the claim, on a
table with tens of rows. Idle cost is effectively zero and stays inside Postgres.

Every minute rather than more often: a minute is below the threshold where somebody watching a
batch would go looking for a refresh button, and the batch screen still drains directly while it is
open, so the scheduler is the *fallback* for a closed tab rather than the primary path.

### Deliberately not included

Concurrency and per-household fairness (§31) both stay out. `SKIP LOCKED` already permits parallel
workers, so adding them later changes the schedule and not the claim — and at one household
neither is measurable.

### As built, and what it cost

The idle path was measured rather than assumed. `explain (analyze, buffers)` on the predicate
against an empty queue:

```
Limit  (actual time=0.007..0.008 rows=0 loops=1)
  Buffers: shared hit=1
  ->  Index Scan using import_jobs_queue on import_jobs
Execution Time: 0.102 ms
```

One index scan, **one buffer hit, a tenth of a millisecond**. At a tick a minute that is about
0.14 seconds of database time per day, no HTTP, and no serverless invocation. The unconditional
version would have been ~43,800 requests a month to keep discovering nobody had imported anything.

**The predicate is tested against the claim rather than beside it.** Seven queue states are run
through both `import_queue_has_work` and `import_claim_next_job`, asserting they agree — because
they are separate pieces of SQL that can drift apart silently, and the direction that drifts
quietly is the queue going to sleep on work it could have taken. Removing the expired-lease arm
from the predicate makes two of those tests fail, which is how the lease reclaim is known to be
exercised by the normal path.

`dispatch_import_drain` returns a reason rather than void, so `cron.job_run_details` distinguishes
an idle queue from an unconfigured one. Without that, a scheduler that had never been given an
endpoint would look exactly like a queue nobody was using.

The endpoint and shared secret live in `private.import_drain_config`, populated by
`pnpm --filter @pashki/db set:drain-endpoint` — a table rather than Supabase Vault, because
Vault's surface differs between the local image and hosted and this repo has been caught twice
trusting those to agree. `private` is not a schema PostgREST exposes, so no client can read it
whatever the grants say.

*Would change if:* the app moves to a host with a real scheduler, or Vercel moves off Hobby. Both
delete pg_net and the shared secret rather than changing what runs.

---

## 36. The shared cache expires on a version stamp and an age, because they answer different failures

**Decided.** `import_cache` entries carry `extractor_version` and are read against both it and
`fetched_at`. An entry stamped with anything other than the current `EXTRACTOR_VERSION` is a
miss; so is one older than thirty days. Neither policy subsumes the other, which is why there are
two.

Until now nothing expired at all. `fetched_at` was written and read by nothing, and `refresh`
existed in `ImportOptions` with no caller — so a cached extraction was permanent, for one row
serving the entire user base.

### The version stamp: a parser fix must reach entries it did not write

This is the failure worth designing against, and it has already happened twice. The tier-0
extractor was corrected once for image references — a bare `{"@id": ...}` overwriting the real
node it pointed at — and once for fetching the normalised cache key instead of the URL as
written. Both times the fix reached new imports and nothing else. Every household that had
already imported the page kept the wrong result, and nothing reported the difference.

**Age cannot solve this.** A fix ships today and yesterday's entries stay wrong until the clock
runs out; shortening the clock enough to matter throws away the cache's whole economic argument
(architecture §11). A version stamp propagates correctness as fast as people ask for it, and
costs one re-fetch per URL somebody actually wants.

It is a hand-maintained integer rather than a hash of the extractor source, and the asymmetry is
the reason: **bumping unnecessarily costs a re-fetch; forgetting to bump costs every household a
wrong recipe indefinitely.** A source hash removes the discipline but invalidates the world on a
comment change — which makes the cheap mistake expensive and inverts the asymmetry that makes
this safe to get wrong. The rule is: when unsure, bump.

Rows written before the column existed default to `0` and are therefore stale. That is
deliberate — backfilling them to the current version would preserve exactly the entries this
exists to invalidate.

### The age: a page changing under us

The stamp says nothing about this case, where the parser is right and the source moved. We fetch
a page once, so nothing observes a correction, a reworked ingredient list, or a URL reused for
something else.

Thirty days, chosen to be generous rather than clever: it is a bound on how wrong we can be, not
an attempt to detect change. Recipe pages drift slowly, and at tiers 0 and 1 a miss costs one
HTTP request and no model call.

### Shape

The policy is a pure function (`packages/import/src/cache-policy.ts`) returning a *reason* rather
than a boolean, so a caller can tell "the parser moved" from "the page might have" — a single
`false` would make the stamp's effect unmeasurable. The Supabase adapter applies it, because that
is where the two columns live and the pipeline should not learn the storage shape to ask a
question about it.

A stale entry is a **miss, not a delete**: the next successful extraction upserts over it, so the
row is replaced by the thing that superseded it rather than by a second write. Rows for URLs
nobody imports again are never collected; that is a reaper's job and is not this.

*Would change if:* tier 2 is wired, at which point a miss costs a model call and thirty days may
be the wrong trade in the other direction. The age is already a parameter for that reason.

---

## 37. Imported photographs are stored as fetched, and resized by the CDN on read

**Decided.** `storeImportedPhoto` validates the bytes and uploads them unchanged. No resizing on
ingest, and therefore **no sharp anywhere in the deployed app**.

### Why it was there, and why that reason had already expired

Ingest-time resizing capped the stored size, stripped EXIF, and normalised everything to JPEG.
But architecture §5 already says display sizes come from **Supabase's image transformation CDN on
read** — so the resize was producing one more variant that nothing displayed. The CDN was always
going to be asked for a card-sized image regardless of what was stored.

### What it cost to keep

sharp is a native addon. It cannot be bundled, so it has to be excluded from the bundle *and*
traced into the function by hand — two separate jobs, and doing only the first ships a deployment
that fails at runtime with `Could not load the "sharp" module using the linux-x64 runtime`. That
failure was invisible locally, where the darwin binary sits in `node_modules` regardless.

Then the fix had a fix: tracing libvips into every API route bloated seventeen serverless
functions past the host's twelve-function limit and the deployment was **refused outright**. A
day was spent on this, and the photographs had been silently missing from production the whole
time.

The honest reading is that a resize step nothing needed was holding a native dependency in every
deployed function, and the dependency was setting the hosting plan.

### What is given up

- **Bigger objects.** The publisher\'s original rather than a 1600px JPEG — megabytes instead of
  hundreds of kilobytes, against a shared 1 GB bucket. Bounded by an 8 MB `maxBytes` refusal, the
  cap resizing used to provide implicitly.
- **Metadata survives.** An imported photo keeps whatever EXIF it arrived with. It is the
  publisher\'s photograph rather than the household\'s, and the CDN strips metadata when it
  transforms on read, so nothing with EXIF is ever served — but it is *stored*.
- **Mixed formats.** The object is named for what it decodes as, so a PNG stays a PNG.

Validation is unaffected: `decodeImage` is our own header parser, so "validate by decoding, never
by the declared content type" survives sharp leaving.

### Phase 3 is not affected

Photographing the finished plate should resize **on the device**, before upload — where the
picture is large, the network is the constraint, and there is no serverless packaging problem to
have. `@pashki/import/sharp` remains for tier 3 screenshot downscaling, which runs in the eval
harness rather than in a deployed function.

*Would change if:* stored size becomes a real cost, or camera uploads need a server-side resize
after all. The answer then is a resize in the worker container (Phase 4), which has ffmpeg and no
function-packaging limits — not sharp back in the web app.

---

## 38. Unreachable photographs are collected on a schedule, and a live review is never collected

**Decided.** `pashki-photo-reaper` sweeps hourly for objects in `recipe-photos` that no `photos`
row claims, no live import job owns, and that are older than **24 hours**.

An import stores its photograph before anyone has agreed to save the recipe, because that is when
the bytes exist, and every storage read policy resolves through a `photos` row. So an abandoned
review leaves an object that is unreachable by every client *and* deleted by nothing — permanent,
invisible, and counted against the bucket. §37 made each one larger, since photographs are now
stored as fetched rather than resized.

### Two rules, and only one of them is a guess

**Not owned by a live job.** A job in `queued`, `running` or `review` owns its photograph. A batch
review left open for a week is somebody\'s unfinished work, not litter, and this rule does not
care how long they take.

**Older than 24 hours.** The imprecise half, and unavoidable: the single-URL preview creates *no
job row at all* — `/api/import` stores an object and hands back a draft — so time is the only
thing protecting a review in progress there. Twenty-four hours is roughly two orders of magnitude
more than a review takes and covers someone opening a review, going to bed, and saving in the
morning. The asymmetry decides it: being generous costs a few megabytes for a day, being tight
deletes a photograph out from under an open review, which a person experiences as the product
losing their work. Err long.

A **tombstoned** `photos` row also spares the object. A soft delete is reversible (§30) and
releasing bytes is not, so only a row that was never created at all makes an object collectable.

### Why it is a route and not SQL

`storage.protect_delete()` refuses direct deletes from `storage.objects`, deliberately, so objects
are never orphaned by a stray statement. The only door is the Storage API, which needs the service
role — so the database decides *what* is collectable and an authenticated route carries it out, on
§35\'s pattern: predicate, conditional dispatch, pg_net. An empty sweep never leaves the database.

Hourly rather than by the minute, because nothing here waits on a person.

### What it found

Nothing, on the first census — and then the census was wrong. Enumerating objects *by household*
missed three, because they belonged to smoke-test households that had already been deleted;
asking `storage.objects` directly found six objects and three unclaimed. All three were one per
smoke run, from the batch job\'s photograph: the runner stores it, the path lives in
`import_jobs.result_json`, and the test deleted the rows without the objects. The test printed
"cleaned up" every time.

Two lessons, both already rules here in other clothes. Enumerate the thing you are auditing, not
the thing you think owns it. And a cleanup that announces success without checking is the same
failure as a check that cannot fail.

*Would change if:* the grace window proves too long to matter for storage cost, which would mean
the product has enough abandoned reviews to be worth asking why.

---

## 39. Children now, invited adults later — and the reason is the acceptance flow, not the table

**Decided.** A household can add, rename, recolour and remove **children** — a name and a colour,
no account, no invitation. Inviting an **adult** who will sign in is deferred.

### Why the split is worth making

They look like one feature and are two. A child is a row: `family_members` has held
`account_id nullable` and `is_child` since Phase 1, and the `child_has_no_login` check already
encodes the invariant. Nothing else is required — no email, no token, no second provisioning
path.

That row is also **most of the value**. The five-point scale, the per-member ratings on the
detail screen and the "whole family likes" filter were all built for a household with several
opinions, and until now a household had exactly one. Children are the members most likely to
disagree about dinner.

### What inviting an adult actually costs

Not the table — an `invitations` row is trivial. The cost is everything around acceptance:

1. A token that is single-use, expiring, and safe to put in an email.
2. An acceptance route that **joins an existing household** rather than creating one. Today
   `provisionForConfirmedAccount` creates a household at first confirmed sign-in, unconditionally.
   Adding a branch there means editing the most-verified path in the application — the one the
   smoke test exercises on every run and the one whose idempotency a double-clicked signup
   depends on.
3. A response that does not reveal whether an address already has an account, which the signup
   route already takes care to avoid and an invitation flow can easily undo.
4. A second email template, and the sending rate to go with it.

### The reason it waits, rather than "it is more work"

**Phase 3 needs the same acceptance flow through a deep link, and that has nowhere to land yet.**
The roadmap already records it: a native signup needs `pashki://` or a universal link in GoTrue's
redirect allow list, and GoTrue silently substitutes `site_url` for anything unlisted. An
invitation built now would be built against the web-only redirect and rebuilt for the app — or
worse, built once and quietly wrong on a phone.

The honest summary is that acceptance is the hard half, it is shared with a Phase 3 dependency
that is not resolved, and shipping the easy half first costs nothing later: adding an adult writes
the same `family_members` row this already writes, with `account_id` set and `is_child` false.

### Also decided here

**Nobody can remove themselves.** Leaving a household is a different action with different
consequences — who owns it afterwards, what becomes of the recipes — and allowing it through the
roster would let somebody delete the only adult and strand a household behind an account that is
a member of nothing.

**Removal is a soft delete and the trigger does the rest** (§30): ratings tombstone, and
`recipes.created_by` nullifies. Both rules were written before anything could create a second
member, so they had never run against a household that had one; they do now, including the case
that matters for the product — a detail screen showing a removed member's rating renders no score
rather than a score with no name.

**Colours are a vocabulary the seam owns.** `family_members.colour` stores `"clay"`, not a hex
value, so restyling is a stylesheet change rather than a data migration, and a value outside the
palette is refused rather than collected. Eight, because five distinguishable ones was the
requirement and two of any eight are a hard pair under deuteranopia — which is why the interface
never uses colour alone.

*Would change if:* a household asks for a second adult before Phase 3 starts. The work is
understood; it is sequenced, not blocked.

### Reversed (2026-08-14): invitations are built

**The deferral was overruled, and the reasoning above was wrong in a specific way worth naming.**
It was not wrong about the cost — acceptance really is the hard half, and it really does branch
the most-verified path in the application. It was wrong about what to optimise for: it treated
Phase 3's deep link as something to *solve first*, when a two-adult household is the ordinary
case and the web flow is what people need now. Sequencing a common case behind an unresolved
dependency of a phase that has not started is deferring the wrong thing.

Built as migration `20260814094000` and §40 below. What it did to the path this section worried
about is the part worth recording: **provisioning was not changed.** A branch sits in front of it
— if the confirmed address has a live invitation, join that household — and joining first makes
`provisionHousehold` a no-op, because it resolves the household through membership and finds one.
The idempotency a double-clicked signup depends on is untouched, and the diff reads as an
addition rather than an edit.

The native app still needs a deep link. It now extends a flow that exists rather than defining
one, which is the cheaper order after all.

---

## 40. An invitation is a hashed single-use token, and the address is the binding

**Decided.** A household invites an adult by address. The invitation is a row with a SHA-256 of a
256-bit token, a seven-day expiry, and timestamps for accepted, revoked and superseded.

### The token is never stored

Only its hash. A leaked backup, a stray log line, or a support query over `invitations` yields
hashes — and a hash cannot be presented to `accept_invitation`. The token exists in the email and
in the URL the invited person clicks, and nowhere in our infrastructure. No pepper: a pepper
protects a *low-entropy* secret from an offline attack, and against 256 random bits it would add a
key to rotate for no gain.

### Claiming is one statement

`accept_invitation` claims the row and adds the member in a single SQL function, for the same
reason `import_finish_job` does (§32). `accepted_at is null` in the WHERE clause of the UPDATE is
what makes it single-use **under concurrency**: two simultaneous clicks both run it, and exactly
one matches a row. Two statements would let a double-clicked link join a household twice.

Every refusal is a named status — `used`, `revoked`, `superseded`, `expired`, `wrong-address`,
`unknown` — rather than a boolean. A person told "that did not work" about a link they were sent
cannot act on it, and naming the reason tells the holder nothing they could not already discover,
since they have the token.

### The address is the binding, not the token alone

A claim must match the address the invitation was sent to. A token in a URL can be forwarded; an
address has been proved by GoTrue. This is what stops a forwarded link admitting whoever received
it, and it is why the provisioning branch can work **without a token at all** — somebody who signs
up because they were invited arrives with a just-confirmed address, which is a stronger claim than
the link they may or may not still have.

### Enumeration

The invite response is identical whether or not the address has an account, and the reason it is
safe is that **nothing looks**. There is no branch on existence to get wrong later. The difference
appears only on the invited person's side, where they already know which case they are in.

### An invitation is a membership, not a purchase

Joining confers no entitlement. The household's own covers its members (§9), which is what makes a
second adult free and what stops an invitation becoming a way to mint access.

### The seam widened, deliberately

`invitations` is a platform table and joined `check-platform-tables.mjs`, so app code cannot reach
it. `packages/db`'s exhaustiveness type caught the omission when it was added to the schema and
not to the classification — the build stopped compiling, which is the guard working.

*Would change if:* invitations need to carry a role. There is no role model today; adding one is a
column and a check, not a redesign.

---

## 41. The planner asks for servings and stores a multiplier

**Decided.** A planner entry is typed as a number of people. `plan_entries.scale` still holds a
batch multiplier, and the conversion happens at the edge.

### Why store the multiplier rather than the servings

The obvious alternative — store the figure the person typed — is more faithful to their intent and
was rejected on one fact: **`recipes.servings` is nullable.** A recipe that never stated a yield
has no defined "feed six", while a multiplier is always defined. Storing servings would need a
fallback for exactly the recipes least able to provide one, and the fallback would be an invented
yield of 1 that quietly multiplies every ingredient by six.

Three smaller things followed the same way. `packages/core` consolidates against a multiplier, so
nothing downstream changes — the shopping list file was not touched. No migration means no new
column grant on a table that has column-level grants (§26). And the planner was **already**
rendering `recipe.servings × scale` to display a servings figure, so the reading existed and only
the input was a menu; this inverts the arithmetic it was already doing.

### The consequence, stated

Editing a recipe's own yield changes what an existing plan *feeds* rather than what it
*multiplies*. A recipe for 4 planned at 1.5× shows "6 servings"; change the recipe to serve 2 and
the same entry shows 3.

That is the honest reading rather than a bug: the entry says "cook half again as much", and half
again as much of a smaller recipe feeds fewer people. Nothing lies — the number shown is always
true of the recipe as it stands — and the person can see it and correct it. Storing servings would
preserve the intent and silently change the multiplier instead, which is the same trade facing the
other way.

*Would change if:* recipes start changing their yields often enough for people to notice. The fix
is a `planned_servings` column recording the intent alongside the multiplier, not replacing it.

### Guards

Servings are whole people, 1 to 50. Fractions are refused — `2.5` servings is a number a
spreadsheet produces, and admitting it is how `0.3333` reaches a shopping list. Zero, negative,
non-numeric and absurd each get an answer. A recipe with no stated yield is given a multiplier
field instead, with its own bounds.

---

## 42. The same recipe twice in a day is discouraged, not impossible

**Decided.** Adding a recipe to a day it is already on returns `409` with the existing entry, and
the planner offers to increase its servings. It does **not** merge silently and does **not**
refuse.

### Why not impossible

A unique index on `(family_id, date, recipe_id)` would be one line and is the wrong line. The
planner is one meal per day *today*; a household cooking the same thing at lunch and dinner is a
real case, and the schema has no concept of meals to express it with. Making it impossible now
means dropping the index when meals arrive — and, until then, a household with a genuine reason
has no way to say so.

### Why not silent

Merging quietly is the shape of a well-meant feature that later gets described as "it changed my
plan". The household is told what is already there and what pressing the button will do, and the
alternative — leave both — remains available.

The offer defaults to the sum: a recipe for 6 already planned for 9, added again, offers 15. That
is what "I want to cook this for more people" means arithmetically, and it is a suggestion rather
than an action.

*Would change if:* the planner gains meals. Then two entries on a day are two *different* meals
and the duplicate check moves to `(date, meal)`.

---

## 43. Calorie estimates are catalog arithmetic, and say when they are incomplete

**Decided, and deliberately unfinished.** `estimateEnergy` in `packages/core` converts an amount to
grams through the same base-unit conversions the shopping list uses, multiplies by kcal per 100 g
from the catalog, and **reports what it could not account for**. Nine ingredients carry
hand-checked figures; the rest do not, and the presentation makes that visible rather than absorbing
it into a total.

### Incomplete must look incomplete

A total that silently omits the chorizo is worse than no total, because it is *plausible* — it reads
as a fact and it is wrong in the direction that flatters. So there are three shapes and only one of
them is a bare number:

```
complete   ~520
partial    at least ~480 · 3 ingredients unknown
nothing    no estimate
```

"At least" is doing the work. A partial total is a **lower bound**, and saying so makes it true
rather than merely implied — anybody reading "480" would take it as the answer.

Rounded to 10 kcal, and prefixed with a tilde. `517` asserts a precision nothing here has: one onion
varies twofold by size, a "medium" chicken breast by more, and how much marinade is eaten rather than
left in the dish is unknowable. Ten is chosen over a round hundred because a hundred reads as a
refusal to answer.

### Salt is nothing; oil is not

`isStaple` keeps salt off the shopping list because you already have it. **That is a statement about
buying, and calories are about eating** — so the two lists are not the same one.

- Salt, pepper, water, ice: no energy. Counted as *negligible*, not unknown, because marking them as
  gaps would make every recipe look incomplete for no reason.
- Oils: 884 kcal per 100 g. `2 tbsp olive oil` is ~240 kcal and belongs in the total, however
  unremarkable buying it is.
- `oil for frying`, with no amount: genuinely **unknown**, and exactly the kind of line that should
  make a total say "at least".

### Coverage, measured — then measured again after sixteen lookups

The first measurement, with 9 of 55 items carrying a figure, resolved **14%** of lines and
predicted a **57% ceiling** from populating the existing catalog. That prediction was the argument
for hand-checking rather than importing, so it was worth testing.

Sixteen more ingredients were then hand-checked — chosen by frequency across the real recipes
rather than by walking the catalog alphabetically. Re-measured across the same 10 recipes, 56
lines:

| | lines | |
|---|---|---|
| resolved to kcal | **30** | **54%**, against a 57% prediction |
| negligible (salt, water) | 5 | not gaps |
| in catalog, no energy figure | **0** | the sixteen closed this entirely |
| energy known, amount not convertible | 3 | see below |
| not in catalog at all | 18 | catalog breadth |

**54% against a predicted 57%, from 16 lookups rather than 55.** The three-point shortfall is
exactly the third row: ingredients that now have an energy figure but an amount nothing can turn
into grams —

- `chicken thighs` written with no amount at all
- `extra virgin olive oil` with no amount — the "oil for frying" case, correctly unknown
- `chopped fresh basil` measured as a bunch, which has no defined weight

Only the last is fixable by data (a `gramsEach` for a bunch, which is a fiction — bunches are not
standardised). The other two are recipes not stating a quantity, which no catalog can fix.

One recipe now reports a **complete** estimate — Mushroom risotto, `~1610` total, `~400` per
serving. The rest correctly say "at least".

### Weight per item, and how it was decided

Energy is per 100 g, so anything counted rather than weighed needs a weight for one. These are
judgements, not FDC nutrient facts, and are recorded as such:

| | grams | basis |
|---|---|---|
| onion | 110 | USDA household measure, medium (2½" dia). Real onions run 70–200 g; a recipe saying "1 onion" is being approximate anyway |
| garlic | 3 | per **clove**, which is the catalog's dimension — not per bulb |
| lemon | 58 | medium, without peel, matching the row the energy came from |
| egg | 50 | large, the size recipes assume unless they say otherwise |
| tomato | 123 | medium whole |
| bell pepper | 119 | medium |
| basil | 25 | per bunch, and the weakest figure here — a bunch is not a standard quantity |

Two densities were needed for volume items: heavy cream 238 g/cup and broth 240 g/cup.

### Every judgement made, per row

Sixteen lookups produced **nine** places where the obvious answer was wrong or ambiguous. That
rate is the argument against automation, and each is recorded with its FDC id:

| ingredient | took | rejected | why |
|---|---|---|---|
| ground-beef | 174036, 254 — 80/20 raw | **174493 turkey**, top hit | the first result was a different animal |
| chicken-thighs | 173627, 121 — dark meat, thigh, meat only, raw | 172385, 221 meat and skin | skin doubles it; boneless skinless is what recipes buy |
| basil | 172232, 23 — fresh | 171317, **233** dried | tenfold, and recipes saying "basil" mean fresh |
| heavy-cream | 170859, 340 — heavy whipping | 170858, 292 light whipping | the catalog's aliases include UK double cream, which is fatter still — see below |
| canned-tomatoes | 333281, 18 — diced | 170052, 26 stewed | diced is the form recipes call for |
| bell-pepper | 170108, 26 — red | 170427, 20 green | the catalog's canonical name is red |
| parmesan | 170848, 392 — hard | 171247, 420 grated | grated is a different packing basis, not a different cheese |
| onion | 170000, 40 — generic raw | 790577, 44 red; 170008, 32 sweet | a 15% spread across varieties nobody distinguishes when cooking |
| garlic | 1104647, 143 | 169230, 149 | two rows, same name, 4% apart; took the Foundation analysis |

**That inaccuracy is now fixed, and it was worse than estimated.** UK *double cream* was aliased to
US *heavy cream*, and UK *single cream* to *half-and-half*. Both are now their own catalog items:
300 ml of double cream reads **~1350 kcal against ~1030** — a **32%** understatement, not the
quarter first guessed. Single cream at 18% fat matched a real FDC row ("Cream, fluid, light",
170857, 195) where half-and-half is 131.

Double cream carries **no FDC id**: the ladder stops at heavy whipping (36–40% fat, 340) and double
cream is 48%. Its 449 is derived from fat content — 48 g of fat at 9 kcal, plus the protein and
lactose — which agrees with UK composition tables to within a percent. Recorded with no id rather
than borrowing a nearby one, because a wrong id is worse than none.

**The rest of the catalog was audited for the same fault**, and these aliased across a real energy
difference. All five are now split, 57 items becoming 65:

| was | became | figures | source |
|---|---|---|---|
| `milk` | `milk` (whole), `semi-skimmed-milk`, `skimmed-milk` | 61 / 50 / 34 | 171265, 171267, 171269 |
| `shredded-cheese` | `cheddar`, `mozzarella`, `shredded-cheese` (the generic) | 408 / 299 | 328637, 170845 |
| `tortillas` | `flour-tortillas`, `corn-tortillas`, `tortillas` | 306 / 218 | 175037, 175036 |
| `ground-beef` | `ground-beef` (80/20), `lean-ground-beef` (90/10) | 254 / 176 | 174036, 174030 |
| `yogurt` | `yogurt` (plain whole), `greek-yogurt` | 61 / 97 | 171284, 171304 |

Every one found a real FDC row, so nothing here is derived — double cream remains the only figure in
the catalog without an id. The tortilla rows took three queries: FDC's search returns puff pastry and
pie crust for "tortilla", and the two Foundation rows that *are* tortillas report no energy in the
search response at all. The figures came from fetching the food records directly.

The generic keeps the common sort in each case, because most recipes write the bare word: plain
"milk" is whole, "beef mince" is ordinary mince, "shredded cheese" stays a catch-all. A recipe has to
say "skimmed" or "lean" to get the other one.

Deliberately *not* faults: `cilantro`/`coriander` and `shrimp`/`prawns` are the same food under two
names, which is exactly what an alias is for. `butter` salted and unsalted are both 717. `beans`
spans black, kidney and chickpeas, but the spread is modest and canned-versus-dried matters more than
variety — left alone.

### Splitting cost nothing in coverage, and the risk it carried was real

More entries mean more chances to miss a match, so it was measured rather than assumed: both
catalogs run against the same live recipe rows, same matcher. **49.2% (31/63 lines) before and
after** — no name lost, none gained. The live corpus contains none of the five foods, which is why
the number does not move; where they *do* appear the split is the whole point, taking lean mince from
1143 kcal to 792 for 450 g and giving milk, yogurt, cheese and tortillas a figure they never had.

The risk was not hypothetical. Asserting only that each old alias still *resolved* would have passed
while being wrong, because `find` falls back to a substring match — so a dropped "2% milk" still
answers, quietly, with `milk` at 61 instead of 50. Asserting the resolved **key** caught two genuine
misses, and one was a matcher bug rather than a data one (below).

**Aliases were indexed as written and queried after normalisation.** Any alias containing a character
normalisation strips was therefore unreachable by anything: "2% milk" was indexed with the percent
sign and looked up as "2 milk", fell through to the shorter "milk", and "5% fat mince" matched
nothing at all. Both read as ordinary catalog gaps. `createCatalog` now indexes the normalised form
as a second candidate — added rather than substituted, and dropped wherever another item already
claims that string, because normalisation is lossy in ways that matter: "diced tomatoes" reduces to
"tomatoes", and a tin is not fresh produce.

A measurement aside, recorded because it cost time: the first coverage figure was 51.8% over 20
recipes, and both were wrong. Soft-delete propagation reached hosted on 13 August at 14:20 UTC, so
recipes deleted before then kept live `recipe_ingredients` rows — 23 of them, plus 12 steps and one
rating. The trigger is correct and everything deleted after that timestamp propagates; the residue is
historical and reaches no screen, since no live `plan_entries` point at a tombstoned recipe. The
corpus is nine live recipes, not twenty.

### Matching is the real problem, and it is a judgement call more often than not

Confirmed on the nine looked up. `butter` returns **ghee at 900** above butter at 717 — the top hit
is wrong. `rice` returns raw at **365** and cooked at **130**, a threefold difference decided
entirely by which row a person picks, and recipes mean raw. `pasta` has the same split. `honey`
returns honey-roast ham and breakfast cereal in its first five.

Of nine lookups, **two needed an explicit raw-versus-cooked judgement** (rice, pasta), one needed the
query rewritten to avoid a wrong top hit (butter), and one was insensitive to the choice (every oil
is 884). That is a high enough rate of judgement to say plainly: **automated matching against USDA
would be wrong often, and wrong invisibly.** Each figure carries its FDC id so a wrong number is
traceable rather than folklore.

### Deliberately absent

No model, and no network call at import or render time. The estimate is arithmetic over data that
was checked once by a person.

*Would change if:* the hand-checked 55 measure above ~60% and the missing lines cluster somewhere a
bulk import would actually reach. The next step is finishing the hand-check, not widening the source.

---

## 44. A parser fix never reaches data already parsed, so the fix is to keep the input

`recipe_ingredients` stores the *result* of parsing — `amount`, `unit`, `item_text`, `note`,
`is_estimated`. It does not store the line the parser was given. When the parser learned to read
`x 1.5kg free-range whole chicken` and `optional: sprigs of bay`, the rows already in the database
kept the old reading and went on matching nothing. Measured across production rather than
estimated: **seven live rows**, six of them in the two Jamie Oliver recipes. This will recur every
time the parser improves, which is the point — parsing is the part of this system most likely to
keep changing.

Repairing those seven exposed the shape of the problem twice over. Four of them
(`150ml unsweetened apple juice`, `100g runny honey`) were not stale at all: the parser **still**
could not read them, because `\b` sat after the number and there is no word boundary between `0`
and `m`. Re-importing would have produced them again, identically. And `x 1.5kg free-range whole
chicken` could not be recovered from `item_text` alone — the leading `1` the old parser consumed
was gone, so the multiplier rule had nothing to fire on and the amount had to be put back on the
front before re-reading. The residue is not the input, which is the whole of this section.

### Re-import is not the general answer

It is the *right* answer for one recipe whose source is still up, and it is what fixes the nine
rows today. It does not generalise:

- **It needs a live source.** Hand-typed recipes have none, photographed ones have none, and an
  imported one is a link that rots.
- **It discards edits.** Somebody who corrected an amount by hand loses the correction.
- **It cannot be done in bulk without breaking a standing rule.** Every import passes a review
  screen before saving, and a background job that re-imports a household's recipes is exactly the
  silent-save path that rule forbids. A hundred recipes is a hundred reviews.

### Re-parsing in place is possible today, and is the wrong shape

`item_text` for a *failed* line still holds the whole original, so re-parsing it would recover
precisely the rows that are broken. It is tempting and it is a trap: for a line that parsed
correctly, `item_text` is the residue (`butter`, not `100 g butter`), so a blanket re-parse would
read `amount: null` off it and overwrite a good amount with nothing. It only works when gated on
"this row looks unparsed", which is a heuristic guarding a destructive write.

And it can only ever recover what survived. Anything the old parser *discarded* — a note it did
not keep — is not in `item_text` and is not coming back.

### The decision

**Store the line as written, in a `raw_text` column, and derive everything else from it.** A
re-parse then becomes recomputing a derived value from an input that is still present, which is
safe by construction and needs no heuristic: read `raw_text`, parse it with today's parser, write
the result. It is the same reasoning as base units — keep what you were given, convert on the way
out — and the same reasoning as `energy_fdc_id`, which exists so a wrong figure is traceable to
its input rather than being folklore.

Backfill is honest about what it cannot do: `raw_text` for existing rows is unknowable, except
where the parse failed and the whole line is sitting in `item_text` anyway. So the column is
populated going forward, backfilled from `item_text` only where `amount is null`, and left null
elsewhere — a row that cannot be re-parsed says so rather than being re-parsed from a residue.

**A re-parse still goes through the review screen.** Recomputing is safe; saving without anybody
looking is not, and the rule that lets cheap models be good enough is the same rule here. The
shape is "re-parse this recipe" offering a diff, not a migration that rewrites a household's
recipes overnight.

Not built yet: the column, the backfill, and the review-screen route are a task of their own. The
nine current rows are cheap to fix by re-importing two recipes, and that is what should happen to
them.

## 45. A section is a label on an ingredient line, not an entity — and a section's yield is not the recipe's

Real recipes arrive in components. A crunchwrap has a sauce; cinnamon rolls have dough, filling,
caramel and icing; one fixture reads `Pineapple Mango Salsa (makes 2 servings)`, then
`Chicken Marinade`, then `For Serving`.

`recipe_ingredients` has no section column, so a heading has two possible fates today and both are
wrong: dropped, or parsed as an ingredient. The second is already measurable — the eval reports
`for the sauce` as a spurious ingredient, and precision sits at 60% partly because of it.

### What is stored: a nullable `section` column, not a components table

The heading, verbatim, on each line beneath it. Null when the recipe has no sections.

A heading is a *property of the line* until something needs a component to behave like a thing.
Modelling components as entities means another table, its own RLS policies and grants, soft-delete
propagation, a sync story and a review screen that can edit them — a large surface to buy something
that today only needs to stop being a phantom ingredient and start grouping a display.

**What would reverse it:** the first feature that needs a component to *do* something — scaling one
component alone ("double the icing"), a per-component energy figure, or a shopping list that buys
per component. Then components become entities and `section` becomes a foreign key. That is a
migration, not a redesign, which is the point of choosing the cheap shape first.

### A section's yield is not the recipe's, and must never be read as one

`Pineapple Mango Salsa (makes 2 servings)` sits inside a dish that serves six. Dividing the whole
dish's energy by two is wrong by threefold, and wrong in the direction that flatters — the same
failure `estimateEnergy` was built to refuse (§43).

So **`servings` is dish-scoped and read only from dish scope**: the JSON-LD `recipeYield` on the
`Recipe` node, or a yield line outside any section. A number inside a section heading is a
component's yield and is **discarded rather than stored**, because there is nowhere honest to put it
and putting it on the recipe would be a lie. It returns when components become entities and it has
somewhere to live.

### What this means for expected outputs

- Every expected ingredient carries the section it appeared under, verbatim, or null.
- A section heading is **never** an expected ingredient. An extractor emitting one has produced a
  spurious line and is scored down for it.
- `servings` is the dish's. Where a page states only a component's yield, expected `servings` is
  `null` — which is a different claim from "the extractor missed it", and the format already
  distinguishes those.
- Section is **reported separately rather than folded into the headline accuracy**. A wrong section
  is a display defect; a wrong amount is a shopping defect. Averaging them together hides which one
  moved.

---

## 46. A refusal is an answer, and the fixture format has to be able to state it

One fixture contains no recipe at all: `comment CHICKEN and I'll DM you the full recipe`. Three of
the URLs are deliberately not recipe pages — a listing page, a Reddit thread, a scanned book
archive. The correct output for each is a refusal naming why. **A plausible curry is the worst
possible output**, because it is confident, invented, and indistinguishable from a real answer by
anybody who did not already know the recipe.

The harness cannot express this. `Fixture.expected` is an `ExpectedRecipe`, and an extractor
returning `null` means "I do not handle this *kind* of input" — the runner records it as skipped and
leaves it out of the figures. Reusing `null` for "there is no recipe here" would let an extractor
that skips everything score perfectly on every refusal fixture, which is the mutation-harness trap
in a new costume: no result read as a pass.

### The shape

`expected` becomes a discriminated union — a fixture states either a recipe or a refusal:

```ts
type Expectation =
  | { outcome: "recipe"; recipe: ExpectedRecipe }
  | { outcome: "refusal"; because: RefusalReason };
```

and an extractor gains a third thing it can return, distinct from `null`:

```ts
{ refused: { because: RefusalReason } }
```

### A withheld link is not a withheld recipe

The commonest social pattern is *"comment 'recipe' and I'll DM you"* — and most of those captions
**print the whole ingredient list anyway**. What is being withheld is the blog link, not the
recipe. So:

> A caption withholding a **link** while printing the ingredients is a recipe.
> Only a caption withholding the **ingredients** is `no-recipe-in-source`.

Getting this backwards in either direction is expensive. Refusing every caption that says "comment
below" would decline most of the corpus — a false refusal on recipes that are fully present.
Accepting one that has nothing but a promise invites the model to fill the gap, which is the
confabulation this whole section exists to catch.

A recipe with **no amounts at all** is still a recipe. `instagram-texas-twinkies.txt` names every
ingredient and quantifies none of them — "half a block of cream cheese", "shred cheddar cheese to
your desire". The correct output is those ingredients with `amount: null`, and it is the sharpest
fixture in the set: it measures directly whether an extractor invents quantities when the source
declines to give them. That is the same failure the reel path will have, where the amounts are
spoken aloud and never written.

`RefusalReason` is a closed set, because the reason decides what the product offers next:

| reason | what it means | what the product offers |
|---|---|---|
| `no-recipe-in-source` | the source withholds it — "comment CHICKEN" | paste the DM'd text, or a screenshot |
| `not-a-recipe-page` | a listing, a forum thread, an archive scan | nothing; the URL is wrong |
| `unresolvable-source` | Facebook, Instagram, TikTok — these never resolve | the screenshot or video route |

That last one already exists as a rule in `CLAUDE.md` — detect and reject up front rather than
letting somebody wait through four doomed attempts. This gives it a measurable form.

### Scoring

| fixture | extractor said | outcome |
|---|---|---|
| refusal | refusal | correct |
| refusal | a recipe | **confabulation** — counted and reported on its own line |
| recipe | refusal | **false refusal** — counted and reported on its own line |
| either | `null` | skipped, exactly as today |

A refusal fixture is one check in the headline. The **reason** is scored separately rather than
folded in: refusing for the wrong reason still saves somebody from an invented recipe, but routes
them wrongly, so it has to be visible without swamping the per-field accuracies.

### Three answers that shape the expectations

**A recipe that names its ingredients and quantifies none of them is a recipe.** Not a refusal —
the same call as `instagram-texas-twinkies.txt`. So the tiffy.cooks coconut curry has *two* correct
answers, and which applies depends on what it is read as:

| read as | correct output |
|---|---|
| the caption alone | `refusal: no-recipe-in-source` — the caption withholds everything |
| the reel, with frames | a partial recipe: the ingredients the frames name, every amount `null` |

`frame-01` — a different tiffy.cooks post, *"Full recipes link in bio"* — is the clean refusal,
because it does not even name a dish.

**URL fixtures state no sections.** JSON-LD carries none: `recipeIngredient` is a flat array, and
pinchofyum renders `Gochujang Sauce:` and `Ramen:` in its card markup where the Recipe node cannot
see them. Expecting sections from a format that cannot express them would score tier 0 against the
*capture*, not against itself. Sections stay expected for **captions**, where the headings are in
the text being read.

**A page whose structured data is a different recipe is scored on what it contains.** The America's
Test Kitchen URL says crispy-skin chicken; its only `Recipe` node is `Sautéed Mushrooms with Red
Wine and Rosemary`. Tier 0 reads that correctly, so the expectation is the mushrooms — scoring it
otherwise would mark a correct read wrong. It is recorded as a **known-wrong fixture**: the product
behaviour is a confident wrong recipe with no signal, which is a trap worth a title-mismatch check
of its own rather than a scoring question.

Neither §45 nor §46 is built yet — deliberately. They are recorded first so the hand-checked
expected outputs are written against the intended answer rather than against what the code does
today.

## 47. Quantities are stored as written and converted at display — and an editing screen shows what will be stored

A household sets `families.measurement_system`. Somebody in that household types `1 lb chicken`,
or imports a recipe from a US blog. Is `1 lb` stored, or is `454 g` stored?

**Stored as written; converted when displayed.** The same reasoning as base units, and as §29's
"as written means the parse": keep what you were given, convert on the way out. Converting on save
is lossy and irreversible — it turns `1 lb` into `453.59 g`, and no later change of preference can
get `1 lb` back. It also silently rewrites somebody's recipe, which is theirs and not ours.

And **an imported recipe's source system is a fact about the source, not about the household.** A
recipe from a British blog is written in grams whoever imports it; a household preference is a
statement about how its members like to *read* quantities, not about what the recipe says. Storing
the household's units would conflate the two, and would make the same imported recipe different
rows in two households — which is exactly what §28 refused for package sizes.

### The consequence that is not obvious: an editing surface must not convert

`formatAsWritten` renders the parse, and the recipe editor and the import review screen **round-trip
through it**: they render each line to text, a person edits the text, and it is re-parsed on save.
So a screen that converted for display would convert *into the store* on the next save — a metric
household opening a US recipe, changing the title, and unknowingly rewriting every amount.

So the rule is not "every screen converts". It is:

| surface | shows | why |
|---|---|---|
| shopping list | household units | it is the household's document, read in a shop against packages priced in those units |
| recipe detail, planner | household units | read-only; nothing round-trips |
| recipe editor, import review | **as written** | the text shown is the text that will be saved; converting would rewrite the recipe |

A screen that edits shows what will be stored. A screen that reads shows what the household asked
for. Stated this way the two halves stop competing.

### What the reported bug actually was

Not a missing preference on the recipe page — the shopping list itself was mixed. `consolidate`
rendered the need and the packages with `formatMeasure(system)` and the per-recipe usage line with
`formatAsWritten`, so a metric household read `600 ml pot` and `500 g` beside `Tuesday takes 1 lb`.
One page, two systems, in the one document read standing in a shop.

Fixed symmetrically, which is worth saying plainly because it **is** a change for US households
too: one holding a metric recipe previously read `Tuesday takes 500 g` beside `2 lb needed`, and
now reads US units throughout. Fixing it in one direction only would have been fixing half of it.

## 48. The workhorse is measured now, and the cheapest model lost

§7's routing table was an August 2026 snapshot with a note to re-benchmark. It has been
benchmarked, against 29 real fixtures with hand-checked output, and **it recommended the wrong
model**.

| | tier 0/1 + core parser (the floor) | `openai/gpt-oss-120b` |
|---|---|---|
| overall | 48.9% | **84.3%** |
| item | 50.0% | 80.2% |
| amount | 54.0% | 90.2% |
| unit | 53.7% | 85.7% |
| title | 40.0% | 72.0% |
| servings | 72.0% | 84.0% |
| time | 80.0% | **80.0% — a tie** |
| recall / precision | 54.9% / 65.0% | 91.5% / 97.4% |
| sections | **0/153** | 118/153 |
| equipment emitted as food | 8 | 0 |

**Workhorse: `openai/gpt-oss-120b` on Together, $0.15 / $0.60 per 1M.** The whole 29-fixture set
costs **$0.0123**, all of it on the seventeen captions — the URLs never reach the model — which is
**$0.00072 per caption, ~$0.72 per thousand imports**. Inside §7's estimate.

### The cheapest option is unusable, and only measurement could say so

`openai/gpt-oss-20b` is a third of the price ($0.05 / $0.20) and scored **15 of 29 fixtures**
against 120b's 25. On eight captions it emits a valid JSON prefix and then **degenerates into
whitespace until it hits the token ceiling** — `finish_reason: length`, the object never closed.
Raising the ceiling to 3000 tokens made it pad to 3000. It does not honour `strict: true`
reliably on this provider.

It is also not cheaper per useful answer: 14,582 output tokens for 15 scored fixtures against
18,189 for 25. The padding arrives on the bill.

**This is what the eval bought.** The table named 120b as *escalation* and something else as the
workhorse; the measurement inverted that, and no amount of reading model cards would have found
the whitespace defect. Re-benchmark quarterly, per §7 — and re-benchmark by running the eval,
not by reading a price list.

### Tier 2 is a line-finder, not a quantity-reader

The most useful thing the run said. Restricted to the **180 lines both extractors matched**:

| | parser | model |
|---|---|---|
| amount | 177/180 (98.3%) | 178/180 (98.9%) |
| unit | 176/180 (97.8%) | 177/180 (98.3%) |

Within one percent — because on a shared line **they are the same code**. The model returns
verbatim text and `packages/core` parses it, so the parser is doing the reading either way.

The 36-point headline gap on `amount` is therefore **entirely about which lines get found**: the
parser finds 180 of 328, the model finds 314. Prose with an ad, a story and a hashtag block round
it is where a model earns its money; reading `1 ½ cups` is not.

**So the design holds, and now on evidence rather than instinct: ask the model for verbatim lines
and let core parse them.** Asking for structured amounts instead would buy at most one percent,
and would cost the thing that percent is measured against — one parser, one set of regression
tests, one place a unit bug can live. It would also make the eval measure two parsers rather than
one extractor.

*Would change if:* a model is measured that reads amounts materially better than core on shared
lines — which would be an argument for improving core, since every tier benefits.

## 49. If a recipe exists as both a caption and a reel, read the caption

Measured, not assumed. Four fixtures were collected precisely to answer this: the same recipe as a
caption **and** as reel frames, with the expectation held constant, so any difference is the
vision tier's error rather than a different truth.

| | caption | reel |
|---|---|---|
| crispy rice salad — item | 93% | **27%** |
| crispy rice salad — recall | 100% | **33%** |
| pad thai — item | 77% | **18%** |
| cost per fixture | ~$0.0012 | ~$0.0018 |

Where both channels answered, the reel found **about a third** of what the caption found, and
**cost more** — a downscaled screenshot is still tokens. Several reels produced nothing usable at
all. §7 called vision the weakest link; this is the number behind the phrase.

**So: caption first, always. The reel path is for the case where no caption carries the recipe** —
which is a real case, and the next section is the one that proves it is worth having.

### The reel path may answer when the caption withholds

`tiffy.cooks` coconut curry is the only fixture in the set where the two channels have genuinely
different correct answers. The caption says *"comment CHICKEN and I will dm you the full recipe"* —
a refusal. The frames show `Garlic powder` and `Then add in hot rice` over a dish the caption
names.

The vision tier read **3 of 3** of the ingredients the frames legibly show, scored 11/14 checks,
and **invented no amounts**. So a reel whose caption withholds is worth reading, and the answer is
a partial recipe with null amounts rather than a refusal. That is the rule §46 records, now with
evidence behind it.

### Screenshots need the sharp preparer, or nothing is sent at all

Phone captures run **1.5–3.7 MB** and the vision path caps an image at 1.5 MB, so with the
passthrough preparer **every reel is rejected before a single call is made**. The eval reported it
as vision failing. Nothing had been tried.

Same class as the provider probe and as the mutation harness reading zero matched tests as a pass:
**a path that was never exercised must not report as a path that performed badly.** Any caller
doing vision — the eval, the worker, the import service — passes `createSharpImagePreparer()`, and
a rejected image is reported as `no-usable-images` with the byte count rather than folded into
"no recipe found".

## 50. A substitution key is usually a catalog key and sometimes a bare name, and the gap is reported

Recorded before the first entry rather than discovered at the thirtieth.

The substitution table wants forty to fifty entries covering what a household actually runs out
of. `SEED_CATALOG` has sixty-five. **They will not line up**: people run out of buttermilk,
self-raising flour, cornflour, crème fraîche and caster sugar, and several of those are not in the
catalog at all. Forcing every substitution onto a catalog key would mean either inventing catalog
entries to hang substitutions from — polluting the shopping list with things nobody buys as a
line item — or dropping the substitutions that have no key, which are exactly the ones somebody
searches for at eight o'clock.

So a key is a catalog key **where one exists** and a bare normalised name otherwise, and the
mismatch is **counted and reported** rather than hidden — the same shape as `metricPackageCoverage`,
which reports how much of the catalog has metric package sizes instead of pretending the gap is
not there.

That report is the honest input to catalog expansion: a substitution whose key is a bare name is a
candidate for the catalog, ranked by something better than a guess about what a household buys.
Coverage is a measurement, and this project has been repeatedly wrong when it treated one as an
assumption.

**What follows from it:** the lookup tries the catalog first, so a substitution keyed to
`buttermilk` and one keyed to a bare `crème fraîche` are found the same way by a caller that only
has the text of an ingredient line. Nothing outside seeding and tests may import the table
directly — the same rule `SEED_CATALOG` lives under, and for the same reason: it is data, and a
correction should not need a release.

## 51. Substitutions are a table, and the caveat is the feature

§6's rule applied to a new feature. "I have no buttermilk" has a correct answer that needs no
model: milk plus a tablespoon of acid per cup, stood for ten minutes. Reaching for inference there
is the same mistake as consulting tier 2 for a page that publishes structured data — measured at
99.3% and free (§48).

**Forty-six entries in `packages/core`, and — unlike the catalog — they stay in code.**

### Operational data belongs in a table; domain knowledge belongs in code

The catalog is in the database because package sizes are **operational**: a pint is 473 ml and a
metric carton is 500, shops change what they stock, and a correction has to ship without a release
(§28). None of that is true here. **Buttermilk is milk plus a tablespoon of acid per cup and always
will be.** The facts do not vary by market, do not go stale, and are not discovered by operations.

And the failure modes point opposite ways. A wrong package size costs somebody a wasted trip. **A
wrong ratio misleads somebody mid-cook**, with a bowl already committed — which wants a code
review, a diff and a test, not an `UPDATE` run against production at speed. `SUBSTITUTIONS` is
therefore *not* guarded by `check-seed-catalog-usage.mjs`; it is read directly, server-side.

An earlier draft of this section had it the other way, on the reasoning that anything data-shaped
belongs in a table. That is the wrong default and the distinction is worth stating so the next
data-shaped thing gets the question asked of it: **is this operational, or is it domain
knowledge?** Operational things change without us and belong in rows. Domain knowledge changes
when somebody learns something, and that is what a commit is for.

### Every option states a ratio and a cost, and the cost is why this is safe to ship

Not a disclaimer — the reason the feature is defensible. Somebody who does not know what they are
trading should not be told to trade it:

- **buttermilk** is milk plus acid, and costs nothing worth minding
- **self-raising flour** is plain flour plus 2 tsp baking powder per cup, *and the ratio is
  load-bearing* — under-measure and it will not rise, over-measure and it tastes metallic
- **butter for oil is not one for one.** Butter is a fifth water, so it is ¾ of the weight in oil,
  and the result will not cream with sugar or hold a laminated dough

Two tests enforce it: **no option may carry an empty `cost`, and none an empty `ratio`.** "Use
yogurt" is not an instruction.

`notFor` names where a substitution is actively wrong rather than merely worse. Greek yogurt
stands in for sour cream in a sauce and splits in a bake; garlic powder cannot brown, so a dish
that begins by frying garlic loses its base; dried herbs as a garnish are simply wrong.

### What is in it, and why those

Chosen for **what a household runs out of mid-recipe**, not as a reference. Dairy and baking
staples dominate, because those are what a recipe wants a cup of and a fridge quietly lacks.
Spices are mostly absent — running out of paprika is annoying and rarely stops a dish — as is
anything whose honest answer is "go to the shop".

Coverage against the catalog, per §50: **23 of 46 keyed, 23 bare.** The bare names are the report,
and they are a better ranked list of catalog gaps than a guess would produce — self-raising flour,
crème fraîche, cornflour, icing sugar, vanilla extract, yeast, shallots.

### What is deliberately NOT in it

**The tail that needs a model.** "What can I use instead of gochujang" has no table answer, and
the honest response is silence rather than a guess. This is the free half, and it ships alone
precisely so the paid half has to justify itself separately — the same argument that keeps tier 0
ahead of tier 2.

**Dietary rewrites.** Making a recipe gluten-free, dairy-free or nut-free is **a safety feature,
not a convenience one**, and it is separate work. A substitution table that says "use almond
flour" to somebody cooking for a nut allergy is dangerous in a way that no amount of caveat text
fixes. Nothing here should be read as a dietary claim, and the UI must not present it as one.

**Rewriting the recipe.** The UI is read-only: an ingredient offers "no X?" and shows what to use.
It does not alter amounts, does not re-render the recipe, costs no quota and calls no model.

## Open: cascade deletions and tombstones

**Not resolved. This waits on the sync engine choice, and exists so the evaluation
has it as a criterion instead of rediscovering it.**

`ON DELETE CASCADE` hard-deletes children. Deleting a recipe removes its
`recipe_ingredients`, `recipe_steps`, `ratings`, `photos` and `shortlist_entries`
rows outright — eight cascading composite keys in total — and writes no `deleted_at`
anywhere. Every other deletion in this schema is a tombstone a device can observe,
per §5's conventions. These are not.

So a device holding those rows learns nothing about their removal unless the engine
itself reports the deletion. A recipe would vanish locally while its ingredients
remained, attached to a parent that no longer exists.

**Scope, which is narrower than it first looks.** Cascades from `families` — account
teardown — are not part of this question. A household being deleted corresponds to a
device wipe, which §20 already does on sign-out. The question is only about
deletions *within* a live household: a recipe, a meal plan.

### Option A — the engine replicates hard deletes

Change nothing. A `DELETE` appears in the write-ahead log, so a WAL-based engine can
see it and propagate the removal.

- **Cost:** none to the schema.
- **Risk:** an engine that detects change by polling `updated_at` cannot see a row
  that is gone — there is nothing left to have a timestamp. A device offline during
  the delete may only recover by re-syncing from scratch, and *silently* holding
  orphans until it does.
- **What to test during the evaluation:** delete a recipe on the server while a
  device is offline, bring the device back, and check whether the children disappear
  locally without a full re-sync. This is the single most informative test of the
  engine's change feed, so run it early.

### Option B — replace cascades with soft-delete propagation

A trigger sets `deleted_at` on children when a parent is soft-deleted, so every
deletion becomes a row update the engine already replicates.

- **Cost:** eight constraints become triggers, and triggers are the thing this
  schema has otherwise kept to one job (`updated_at`). Tombstones accumulate with no
  reaper, so a household that deletes a lot never reclaims the space. Hard deletes
  must then be treated as an administrative operation that devices cannot observe —
  which is fine only if nothing normal does one.
- **Benefit:** it does not depend on the engine seeing anything we did not write.
  Deletion becomes an ordinary update, which is the same mechanism that already
  works.

### What decides it

Whether the chosen engine's change feed is WAL-based or timestamp-based. If WAL,
Option A is free and Option B is work for nothing. If timestamp-based, Option A does
not function and Option B is the only one that does.

A likely landing point is both: Option B for household deletions, cascades retained
for account teardown where a wipe is correct anyway. Recording that so it is a
considered outcome rather than a compromise arrived at under pressure.

---

## Unresolved

| Question | Why it blocks | Who can answer |
|---|---|---|
| Apple's outside-purchase rules | Could dictate the whole billing architecture | Apple's live guidelines + someone who ships subscription apps |
| Sync engine | Highest-risk dependency | Evaluation against current options, using §24's criteria |
| Cascade deletions vs tombstones | A device can hold orphaned children forever, silently | Follows the engine choice — see *Open: cascade deletions and tombstones* |
| Copyright posture on imported photos and prose | Changes what you store and display | Someone who does this professionally |
| Free tier / trial / paid-only | Affects quota design and cost exposure | You |

## §52 — Vision is Sonnet, chosen on failure mode rather than accuracy

`PASHKI_LLM_VISION_MODEL=claude-sonnet-5`. Text stays on Together's
`openai/gpt-oss-120b` (§7, §48) — this is a vision-only change.

**The case is the asymmetry of how each model fails, not the accuracy gap.**
Both numbers below are from the same two images: a fresh full-resolution
photograph of Grandma Overton's Rolls, front and back, handwritten in cursive,
lying sideways, one dough with a `(Cinnamon Rolls)` variant on the back.

Haiku 4.5, given the pair sideways, returned `"Peppermint Candy Fudge"` — six
ingredients, six steps, schema-valid, fluent, and nothing to do with a recipe for
bread rolls. At a gentler compression it returned `"Peppermint Patties"`. The card
has a red-and-white striped border; unable to read the writing, it read the
decoration. With the orientation probe correcting the rotation it recovered the
recipe and the variant split, but still wrote `1/2 c. milk` where the card says
`2 c. milk`, and `1 c. flour` where the card says `6 c. flour`.

Sonnet 5, same pair, same probe:

```
title: "Grandma Overtons Rolls"
  2 c. milk · 1/2 c. sugar · 1/2 c. shortening · 2 packages dry yeast
  1/3 c. lukewarm water · 1/2 tsp. sugar · 2 eggs · 6 c. flour · 1 tsp. salt
  [Cinnamon Rolls] sugar and cinnamon to taste · butter · cream cheese frosting
```

Both quantities correct. And read *sideways*, before the probe existed, Sonnet
still got the recipe substantially right — dropping only the numbers it could not
resolve (`c. milk`, bare `flour`) rather than inventing any.

**That is the choice.** Haiku invents where it cannot read; Sonnet omits. A blank
field survives the review screen honestly — someone sees a gap and fills it. A
fluent invention does not: it reads as a successful import, and nothing in the
schema, the validator or the screen can tell it from a reading. On a box of
handwritten family recipes that asymmetry is worth the price difference.

**Cost per card**, two images, probe plus extraction. Token counts measured;
per-million rates verified against Anthropic's published pricing on 17 Aug 2026:

| | in | out | rate | cost |
|---|---|---|---|---|
| Sonnet 5 | 9,065 | 1,139 | $2 / $10 per MTok | **$0.030** |
| Haiku 4.5 | 9,341 | 1,158 | $1 / $5 per MTok | **$0.015** |

(probe ~3,234 in / ~80 out on both; extraction 5,831/1,059 on Sonnet, 6,107/1,078 on Haiku)

So **about 2x, not 3x.** An earlier draft of this section quoted $3/$15 for Sonnet 5
from memory and put the ratio at 3x; the published rate is $2/$10 — the
introductory price announced at launch became the standard one, and the scheduled
increase did not happen. Three cents a card, on a channel that is the only way a
handwritten card enters the system at all.

**Haiku's numbers stay on record deliberately.** The comparison is the reason for
the choice, and the next model swap should be measured against both rather than
against Sonnet alone — §7 says the model is a config value due for
re-benchmarking, and a benchmark with one data point is not one.

Enabled by 0612325, which stopped defaulting `temperature` on the Anthropic
provider. Claude 5 answers `temperature is deprecated for this model` with HTTP
400, so every Sonnet call would have failed outright; that fix was made for
exactly this upgrade.

**Open:** the orientation probe disagreed between models on the back image —
Haiku said +270°, Sonnet said +180° — while both transcribed the same line of
writing. The extraction was correct either way, so this is not blocking, but a
probe that is right about the words and inconsistent about the angle is not
understood, and it should be measured across the fixture set rather than
explained away.


### §52 addendum — two things the pricing check turned up

**`drawImage` is proven.** The canvas path was listed as unverified through several
commits, correctly: the geometry had six tests and the paint had never executed.
It has now — a browser upload of the sideways overton files through the Photograph
tab reached the review screen with *Grandma Overtons Rolls* and its ingredient
list. The canvas turns the card upright. Closed, on evidence rather than on the
absence of a failure.

**`inference_geo` is not being set, and CLAUDE.md requires US-hosted inference.**
The usage block on every vision call reports `"inference_geo":"not_available"`,
which means these requests take the global default routing rather than pinned US
inference. For Claude 4.6 and later, `inference_geo: "us"` is the parameter that
pins it — and it carries a **1.1x multiplier on every token category**, so the
verified figure above would become about $0.033 a card.

That is a compliance question before it is a cost one, and it is not settled here:
whether the rule in CLAUDE.md means the parameter must be set, or whether it was
written about *where a provider is hosted* rather than about request routing, is a
question for whoever wrote it. Recorded rather than guessed at, and it should not
stay open long — every photograph imported until it is resolved goes wherever the
default sends it.
