# On-device data model

*Design only. No Expo, no app, no sync engine chosen — this is what a device has to
hold and enforce, written before an engine is evaluated so the evaluation has
criteria instead of preferences.*

Every isolation guarantee built so far is a server-side predicate:
`private.current_family_ids()` reads `family_members`, and four RLS policies per
table consult it. SQLite has no equivalent and never will. So the question is not
"how do we port RLS" — it is **what does the device hold such that isolation does
not need enforcing.**

The answer, in one line: *the device holds one household's rows and nothing else,
the file is the boundary, and every write is re-checked by the server anyway.*

---

## 1. What the device holds

Three classes, and the class matters more than the list. A table is in exactly one.

### Synced — household rows, read and written locally

| | |
|---|---|
| `recipes` | including `visibility`, so the app can show what is published |
| `recipe_ingredients` | |
| `recipe_steps` | cook mode is unusable without them |
| `ratings` | |
| `meal_plans`, `plan_entries` | |
| `shortlist_entries` | |
| `pantry_items` | |
| `photos` | the rows. **Not the bytes** — see below |

Nine tables, and the shape of the list is the rule. **Both `family_id` and
`deleted_at` are necessary to be syncable at all:** without `family_id` a table
cannot be checked for foreign rows, and without `deleted_at` a deletion cannot
reach a device in a form it can see. Eleven tables qualify; two are excluded for
reasons of their own — `family_members` because it is a platform table whose useful
content arrives in the token, and `import_jobs` because it is server-authoritative.
Necessary, then, not sufficient — but it decides future cases, which a list does
not.

### Fetched over HTTP and cached — reference data, read-only on device

**The grocery catalog** (`ingredients`, `grocery_packages`). Needed offline: the
shopping list cannot consolidate a pint of cream across Tuesday and Friday without
package sizes. But it is identical for every household, it changes when we deploy
rather than when a user acts, and it has no `family_id` — putting it in the sync
stream would break the invariant above for data that is the same 152 rows for
everyone.

So: a **versioned snapshot** fetched over HTTP, cached locally, refreshed when the
version changes. `createCatalog(items)` already builds a catalog from plain data, so
the device does with a snapshot exactly what the server does with `SEED_CATALOG`.
Bundle one with the app as a floor so a first run with no signal still works.

**The family roster.** `family_members` is a platform table, and §16 says clients
get no write path and the app never queries them directly. It does not need to:
**the entitlement token already carries the roster** — `members`, with display names
and `isChild` only, no emails. `ratings.family_member_id` resolves against it. A
member added on another device appears at the next token refresh, which is
acceptable because adding a family member is an online act by nature.

That is the whole reason no platform table is replicated to a device: the two things
a device needs from them — who is in the household, and what it may do — both arrive
inside the token.

**Photo bytes.** Fetched from the transformation CDN and cached in a per-household
directory mirroring `photos.storage_path` (`<familyId>/<photoId>.jpg`), so wiping a
household is deleting one directory. Never in SQLite: blobs in the sync stream cost
bandwidth on every device for images most of them will never open.

### Never on a device

| | Why |
|---|---|
| `import_cache` | Belongs to nobody, keyed by URL hash, holds other households' scraped pages, has no `family_id`, and is unbounded. The single clearest example of a table a phone must not hold. |
| `accounts`, `families`, `devices`, `subscriptions` | Platform tables. Nothing on the device has a question they answer. |
| `entitlements` | The device gets the **token**, not the row. §16, and the token is the artefact designed to travel. |
| `import_jobs` | Server-authoritative and short-lived. A device polls its own in-flight imports over HTTP; the table holds `input_ref`, `result_json` and `error`, none of which a device needs after the review screen. Syncing it would put raw import payloads on every device permanently to serve a status spinner. |
| Any other household's anything | Not a policy on the device. A structural property of holding one household. |

---

## 2. Household isolation without RLS

**We support one household per device at a time.** Not two, not a household picker
with both resident.

The reason is precisely that RLS does not exist locally. A device holding two
households needs `where family_id = ?` on every read, applied by application code,
forever, with nothing checking it — which is the "logic you have to remember
everywhere" that §5 rejected for exactly this problem on the server. A device
holding one household needs no predicate at all, because there is no other row to
leak. **Absence is the only enforcement that cannot be forgotten.**

What that concedes: switching households — a second family, a caregiver, an adult in
two households — means a full local wipe and re-sync. That costs bandwidth and a
few seconds, bounded by one household's data, which is small. It is a real cost paid
by a small number of users, against a leak risk carried by all of them.

Four layers, in order of how much they can be trusted:

1. **The file is the boundary.** One SQLite database per household, at a path
   containing the `family_id`. A stale file from a previous household cannot be
   silently reused because it is not the file that gets opened.
2. **Every synced row still carries `family_id`,** redundant though it is when the
   file holds one household. Two reasons: the local schema stays identical to the
   server's, so no engine needs a projection; and "does this file contain a foreign
   row" becomes one query per table instead of unanswerable.
3. **A post-sync integrity assertion**, the on-device analogue of
   `private.assert_rls_invariants()`: for each synced table, no row may have a
   `family_id` other than the expected one. It reports **three outcomes, not two** —
   clean, foreign rows found, or not yet synced — because an empty database on first
   run is legitimately empty and must not read as a pass (CLAUDE.md: silence reads as
   success). Foreign rows mean quarantine the file and re-sync from scratch; this is
   the only mechanism that can catch a sync-engine bug rather than trusting one.
4. **Sign-out deletes the database and the photo directory.** Not "clears the
   session" — deletes. On a device with no policy engine, forgetting the data is the
   only revocation that works, and the `devices.revoked_at` tombstone on the server
   is what stops it syncing back.

Server-side, nothing changes: the sync engine authenticates as the user and RLS
decides what it may pull. **The device never holds a credential that could read
another household** — if a bug or a hostile client asks for more, the server refuses.
On-device isolation is therefore a defence against our own mistakes, which is the
honest description of what it is.

---

## 3. The entitlement token on a device

### How it arrives

`GET /entitlement/recipes` on the seam's HTTP surface, which exists. The response
carries the signed token plus what the UI needs to render; the device stores the
token string.

### Where it lives

**The OS keystore** — iOS Keychain, Android Keystore-backed storage — not the SQLite
file and not plain preferences. Two reasons, and neither is the obvious one.

The token is **not a credential.** It cannot write to the server; server writes need
the user's Supabase JWT and pass through RLS, where
`private.household_can_write()` re-checks the entitlement against `entitlements`.
A stolen token grants nothing. So the reason to keystore it is *integrity* — making
it awkward to hand the local app a forged window — plus keeping the roster's display
names out of a file that lands in device backups.

Which leads to the load-bearing sentence of this section: **the on-device
entitlement check is UX, not enforcement.** A rooted device can grant itself local
writes and the server will still refuse them. Design accordingly, and do not build
attestation for a check whose failure mode is that a determined user briefly sees
an optimistic UI.

### How it refreshes

- On app foreground, if signal and the cached token is older than a day.
- Immediately whenever `Access.shouldRenew` is true — that is what the flag is for.
- **Before re-evaluating access on reconnect**, so a stale token never causes a
  refusal a fetch would have avoided. This ordering is the whole difference between
  correct and infuriating.

Windows: `valid_until` about 30 days out with 7 days of grace, per
`DEFAULT_GRACE_DAYS`. Grace is not really about billing — a card fails and gets
fixed in hours. **Grace is the connectivity budget:** it is how long a device can
fail to reach us before the app changes behaviour. A week is a holiday with bad
signal. Sizing it as a billing courtesy undersells what it does.

### When it expires with no signal

`authoriseToken` returns `read-only`, never a locked state, and there is no
`expired` status to accidentally handle as a lockout. On the device that means:

**Read-only never touches:** opening any recipe, cook mode, the shopping list,
ticking items off, timers, search, the week already planned. Ephemeral device state
— check marks, cook-mode progress — is not household data, is not synced, and is not
gated. Shopping mode works with no signal and no valid token, which is the
requirement.

**Read-only refuses:** new durable writes — saving a recipe, editing one, rating,
changing the plan. The refusal happens at **one local write path**, not at each call
site. That single choke point is where the check we cannot express as a policy
lives, and centralising it is the mitigation for not having RLS.

**Writes already queued are never discarded.** An outbox entry created while the
token was valid syncs when signal returns. If the household really has lapsed, the
server refuses with `42501` and the app surfaces it then — losing a user's work to
guess at a billing state we cannot observe offline is strictly worse.

**Unverifiable is treated as read-only, not as invalid.** If the token's key id is
unknown — a rotation the device slept through — the app degrades to read-only and
triggers a key refresh. It does not decide the token is garbage and lock. §9's floor
applies to our own failures too, not just to expiry.

### Quota

The token carries a snapshot so a device can show "160 of 500". It is not spent
locally and not enforced locally: an import is a server operation by definition, so
the spend happens where the atomic statement is. Display only.

---

## 4. Public key distribution

The verifying key cannot live only in a bundle. A bundle is frozen at ship time, app
updates are not universal, and a key that cannot be replaced cannot be rotated —
which makes the key ids in §15 decorative.

**A published key list.** `GET /keys` on the seam: unauthenticated, cacheable,
returning every currently-valid public key with its id. Unauthenticated because
public keys are public, and because a device that cannot verify its token is a
device we want fetching keys, not one blocked behind the thing it is trying to
check.

- **Bundled snapshot as a floor.** Shipped with the app so a first run offline can
  verify. Refreshed at most daily, persisted next to the token, and the persisted
  set wins over the bundled one.
- **Publish before signing.** A new key appears in `/keys` at least
  `token lifetime + grace + key staleness` before it signs anything — call it 45
  days at the windows above. A retired key stays published until every token it
  signed is past grace. Rotation that skips the overlap turns every offline device
  read-only, and this is the one operational rule here that has teeth.
- **Never fail closed on a missing key.** Unknown key id → read-only + refresh, as
  above.

**The threat model, stated so this is not over-built:** the key list is served over
TLS from our own domain and is not itself signed. A forged list would let someone
mint a token their own device accepts — granting them local writes the server then
refuses. So key distribution needs integrity against *accidents* — stale bundles,
botched rotations, a CDN caching a retired key — not against an adversary who has
nothing to win. If tokens ever gate something the server does not re-check, this
paragraph is wrong and the list needs its own signature.

---

## 5. Which constraints a device can enforce

SQLite is more capable here than it is often given credit for. What it lacks is not
constraint support but *policies* — there is no RLS, no `SECURITY DEFINER`, no
predicate injected into a query the application did not write.

| Constraint | SQLite | Notes |
|---|---|---|
| `CHECK` | Yes | The ten on synced tables port unchanged |
| Composite FK | Yes | Needs a `UNIQUE` index on the parent columns — we already have it on `recipes`, `meal_plans`, `family_members` |
| Deferred FK | Yes | `DEFERRABLE INITIALLY DEFERRED`, which is what out-of-order arrival needs |
| FK enforcement at all | **Off by default** | `PRAGMA foreign_keys = ON`, per connection. Silence reads as success: an engine that never sets it has no FKs and looks fine |
| Partial unique index | Yes | Since 3.8.0; `where deleted_at is null` ports literally |
| `updated_at` trigger | Yes | But must fire on **local writes only** — see below |
| RLS / policies | **No** | The gap this document exists to answer |

### What we would not concede

Hard criteria for the sync engine evaluation. An engine failing any of these is
disqualified, not weighed.

1. **`family_id` reaches the device on every synced row.** An engine that strips
   columns, or stores rows opaquely enough that we cannot query for a foreign
   `family_id`, removes the only check that can catch its own bugs.
2. **`updated_at` is applied verbatim from the server, never rewritten locally.** A
   local trigger firing on replicated rows makes last-write-wins a function of
   device clocks, and §11 accepts LWW on the assumption that it is not. Local
   triggers must fire on local writes only — and if the engine cannot distinguish
   the two, we maintain `updated_at` in the write path rather than by trigger.
3. **Deletions replicate as something the device can observe** — our `deleted_at`
   tombstones, or hard deletes the engine reports. A deletion the device cannot see
   is indistinguishable from a row that never arrived.
4. **Sync can be scoped to one household.** An engine that must replicate everything
   the user is permitted to read cannot implement §2.
5. **Sync authenticates as the user, with server-side rules.** No shared key, no
   client-declared scope. RLS must remain the thing deciding what leaves the server.
6. **A local write is durable before it is acknowledged.** An outbox that loses a
   write on crash is disqualifying for a shopping list someone is standing in a shop
   holding.

### What we would concede, in order of willingness

1. **Local FK enforcement.** Give it up first. The server holds the invariant, the
   composite keys just caught two real bugs there, and the on-device assertion
   catches the pathological case. The cost is transient dangling children — an
   ingredient whose recipe has not arrived — and the UI has to tolerate a
   partially-arrived recipe regardless of constraints.
2. **Local partial unique indexes.** Concede. An undelete arriving before its delete
   violating a local index is worse than briefly allowing two "one per week" meal
   plans. The server's index is the authority; the UI picks deterministically
   (highest `updated_at`, then lowest `id`) instead of failing.
3. **`ON DELETE CASCADE` locally.** Concede entirely — a cascade is server
   behaviour. But see the consequence below, because this one is not free.
4. **Local `CHECK` constraints.** Last, and reluctantly. They are nearly free and
   they catch our own bugs at the point of the bug. Losing them means the local
   store is not a schema we own — which is a reason to prefer an engine that gives
   real tables over one that gives views over opaque storage, all else equal.

### Two consequences worth writing down now

**Cascades produce deletions with no tombstone.** `ON DELETE CASCADE` hard-deletes
children; `recipe_ingredients` rows vanish with no `deleted_at` written. A device
holding them learns nothing unless the engine observes hard deletes. So criterion 3
above has a second half: *either* the engine replicates hard deletes, *or* the
eight cascading composite keys become soft-delete propagation. Both options, their
costs, and the one test that distinguishes them are written up as an open item in
`docs/decisions.md` — deliberately unanswered, because it follows the engine choice.

**`photos.storage_path` assumed the object already exists.** Fixed rather than
deferred, because it was a migration and it was small: `upload_state` is
`pending | stored`, the path is reserved at capture, and NOT NULL survives. Checking
what a pending path did to the storage read policies turned up a worse bug than the
one being fixed — the policies trust the `photos` row, clients write `photos` rows,
and nothing tied a row's path to its own household, so a household could name
another household's object and read it. Two constraints close it; decisions §25.

---

## 6. What this design needs that does not exist

Phase 3 work, listed so the roadmap can absorb it:

- `GET /keys` on the seam's HTTP surface.
- A versioned catalog snapshot endpoint, and a version to compare against.
- The local write path and outbox — one choke point, with the entitlement gate in
  it.
- The post-sync integrity assertion, with its three outcomes.
- A storage write policy for camera photos, and the uploader that drains
  `upload_state = 'pending'`.
- A scheduler for `import_jobs`, still unbuilt and unrelated to this document except
  that a device polling its own imports needs the drain to actually run.

---

## Open questions

**Encryption at rest.** iOS encrypts the app container when the device is locked;
Android's guarantees vary by OEM and API level. SQLCipher is the usual answer and
costs a native module plus key management. Household recipes and children's ratings
are not medical records, but "who in this house eats what" is not nothing either.
Deferred deliberately — it is a switch, not an architecture, and it should be
decided against a threat model rather than an instinct.

**Two households, later.** If the wipe-on-switch cost turns out to bite real users,
the upgrade is one database file per household with the *file* still as the
boundary, never two households in one file. Recording that now so the cheap version
does not become the reason the correct version is hard.
