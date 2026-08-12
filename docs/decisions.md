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
