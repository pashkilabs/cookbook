# Pashki Labs — Recipe App
## Production Architecture & Delivery Plan

*Draft 1 · August 2026*

---

## 1. What we're building

A family recipe manager: capture recipes from anywhere on the internet, learn who in the household actually likes what, plan a week of meals, and produce a shopping list that consolidates ingredients across recipes so nothing is bought twice or wasted.

It is the first product on the **Pashki platform**. Families subscribe to Pashki and get access to a portfolio of apps. That single fact drives most of the structural decisions below: identity, the family record, entitlements and billing belong to the platform, not to this app.

### Confirmed requirements

| | |
|---|---|
| Audience | Public product, open signup |
| Platforms | iOS, Android, and web |
| Sync | Across all household devices |
| Offline | Full function with no signal |
| Data residency | US only — all inference and storage |
| Team | Solo, with Claude doing the heavy lifting |

---

## 2. Principles

**Deterministic before AI.** Most recipe pages publish machine-readable recipe data. Reading it is free, instant and more accurate than any model. AI is the fallback, not the default. This single decision removes the majority of the running cost and most of the failure modes.

**The domain package is the product.** The ingredient parser, unit conversion and package maths are what nobody else has. Everything else — screens, auth, hosting — is replaceable. Build and test that first, in isolation.

**The platform seam is sacred.** The app must never touch user, family or billing tables directly. All access goes through a client library. Get this boundary right and extracting a real platform later is mechanical rather than surgical.

**Don't build the platform first.** Ship the recipe app with a deliberately thin platform beneath it. Let app #2 tell you what actually needs generalising.

**Assume the prototype's UI is disposable; assume its logic is not.** The React screens become the web app. The parsing and maths get extracted, hardened and shared.

---

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language across web, native, server and shared logic — and the single biggest factor in how effectively Claude can refactor across the repo |
| Web | Next.js on Vercel | Server-rendered public recipe pages drive sharing and search; API routes double as the import service |
| Native | Expo / React Native, EAS builds | One codebase for both stores; share-target support via config plugin |
| Database | Supabase Postgres | Relational data, full-text search on ingredients, row-level security for household isolation |
| Auth | Supabase Auth | Platform-owned, wrapped by the platform client |
| Object storage | Supabase Storage + image CDN | Recipe photos, resized server-side at import |
| Media worker | Container on Fly.io / Cloud Run | ffmpeg cannot run in serverless functions |
| Queue | Postgres `import_jobs`, claimed with `FOR UPDATE SKIP LOCKED`; dispatched by pg_cron (decisions §35) | Batch imports and media jobs are async by nature. Inngest and Trigger.dev were not needed: the queue is one table and one function, and a hosted queue would add a vendor to own the one thing the database already does atomically |
| Billing | Stripe + RevenueCat | RevenueCat exists specifically to unify entitlements across web, App Store and Play |
| Sync | Postgres→SQLite replication (PowerSync / Electric class) | Local database on device is what makes offline real rather than bolted on |
| Inference | US-hosted only — see §8 | |
| Tests | Vitest, concentrated on `core` | |

### Deliberately rejected

- **Firebase** — the document model fights the shopping-list and meal-plan queries.
- **React Native Web** — would cost the server-rendered public pages that are the growth loop.
- **Capacitor wrapper** — with a real web app in scope, the native build should be genuinely native.
- **Self-hosted inference** — at these volumes a rented GPU costs several hundred times the API spend.
- **Hand-rolled sync** — the fastest route to a six-month detour.

---

## 4. Repository layout

```
pashki/
├─ apps/
│  ├─ web/                  Next.js — marketing, signup, public recipe pages, planner
│  ├─ mobile/               Expo — share target, camera, shopping, cook mode
│  ├─ api/                  Import service, webhooks, entitlement issuance
│  └─ worker/               ffmpeg container — audio + frame extraction
├─ packages/
│  ├─ core/                 ⭐ parser, units, package maths, consolidation
│  ├─ platform-client/      ⭐ the seam: auth, family, entitlements, quota
│  ├─ import/               readers, extractors, AI cascade, fusion
│  ├─ ui/                   design tokens, shared primitives
│  └─ db/                   schema, migrations, generated types
└─ turbo.json               pnpm workspaces + Turborepo
```

The two starred packages are the ones worth being precious about.

**Built so far:** `packages/core`, `packages/db`, `packages/platform-client`,
`packages/import` and `apps/web` — the last of which is deployed (`docs/deployment.md`).
`packages/ui` is still a plan, and `apps/api` never became a separate app: the import
service and the seam's HTTP surface are route handlers inside `apps/web`, which is one
fewer deployment for no loss. `apps/mobile` and `apps/worker` are Phases 3 and 4.

`platform-client` and `import` both require the service role, so they run on a server.
Apps reach the seam through the HTTP routes in `platform-client` (§6) rather than
importing it into a client bundle, and `scripts/check-server-only.mjs` enforces that.

---

## 5. Data model

*Built in `packages/db`. This section tracks the migrations — if the two disagree,
the migrations are right and this is stale.*

Conventions that apply to every table, so they are not repeated below:

- **UUID primary keys** (`id`), so a device can mint one offline.
- **`created_at` and `updated_at`** on every row, `updated_at` maintained by
  trigger rather than application code — a sync engine writing straight to
  Postgres never runs our code.
- **`deleted_at`** on anything a device can delete. Tombstones stay *readable*: a
  deleted row a peer cannot see is indistinguishable from one that never synced.

The sync engine is still unresolved (§14), so the schema stops there — no
publications, no replication slots, no engine-specific extensions.

### Platform tables (Pashki-owned)

Read-only to clients. Every mutation goes through `platform-client` on the service
role.

```
accounts            id, email, created_at, updated_at, deleted_at
                    -- id IS auth.users.id, so auth.uid() compares directly and no
                    -- policy needs an extra hop
families            id, name, owner_account_id, created_at, updated_at, deleted_at
                    -- owner FK is ON DELETE RESTRICT: deleting an owning account
                    -- fails by design; teardown is a flow, not a cascade
family_members      id, family_id, account_id?, display_name, colour, is_child,
                    created_at, updated_at, deleted_at
                    -- account_id NULL for children who are rated but don't sign in
                    -- CHECK (not (is_child and account_id is not null))
                    -- the root of trust: private.current_family_ids() reads this
devices             id, account_id, platform, last_seen_at, revoked_at,
                    created_at, updated_at
                    -- revoked_at is the tombstone; platform in (ios|android|web)
subscriptions       id, family_id, provider, external_id, status, renews_at,
                    created_at, updated_at
                    -- provider in (stripe|app_store|play); UNIQUE (provider,
                    -- external_id) makes a replayed webhook an upsert
entitlements        id, family_id, app_key, tier, quota_json, valid_until,
                    grace_until, created_at, updated_at
                    -- UNIQUE (family_id, app_key), CHECK (grace_until >= valid_until)
                    -- grace_until is a column because the RLS predicate that
                    -- enforces read-only reads it, and it must agree with the token
                    -- to the millisecond (decisions §9)
```

**The critical split: `family_members` are not `accounts`.** Adults have logins. Children get rated but never sign in. The prototype stumbled onto this with its separate "eaters" list; here it's formalised. Every app in the portfolio inherits this family definition rather than asking users to rebuild it.

### App tables (recipe-owned)

Every household table carries `family_id` and has four RLS policies — select,
insert, update, delete — on the same predicate. Child tables reference
`(parent_id, family_id)` as a **composite foreign key**, so a row cannot claim a
household its parent does not belong to.

That applies to *every* reference between household tables, not only to obvious
parent-child pairs: `ratings.family_member_id` and `recipes.created_by` point at
`family_members` compositely too, or a household could attribute a rating to
somebody it has never met. `private.assert_rls_invariants()` fails any migration
that adds a single-column reference between two tables that both carry
`family_id`, because these constraints are written per table and that is where a
typo hides. References to `families` itself stay single-column — there is no
second column to pair with — and the invariant skips them for that reason rather
than by name.

```
recipes             id, family_id, title, source_url, source_name, servings,
                    time_minutes, status, visibility, make_again, times_made,
                    created_by, created_at, updated_at, deleted_at
                    -- created_by -> family_members (id, family_id), so the UI
                    -- can name a person who may not have a login. Nullable —
                    -- most recipes are imported and nobody typed them. ON DELETE
                    -- SET NULL (created_by) names the column, or removing a
                    -- member would try to null family_id and fail instead.
                    -- UNIQUE (id, family_id) is the target for every child
                    -- table's composite FK.
                    -- visibility: 'private' (default) or 'public'. Public is
                    -- world-readable and indexable by anon, not an unlisted link
                    -- (decisions §17). anon reads it through column grants, so
                    -- family_id / make_again / times_made / created_by / status
                    -- are not selectable by anon at all.
recipe_steps        id, family_id, recipe_id, position, text,
                    created_at, updated_at, deleted_at
                    -- the method, one row per step. A child table rather than a
                    -- text[] for two reasons: last-write-wins is per row, so an
                    -- array would lose one of two people's simultaneous edits to
                    -- different steps; and cook mode's per-step state (timers,
                    -- check-off, an ingredient pinned to a step) needs a step to
                    -- have an id. NOT public — the method is the source's prose,
                    -- which is the unresolved copyright question. See decisions §19.
recipe_ingredients  id, family_id, recipe_id, position, amount, unit, item_text,
                    ingredient_id?, note, is_estimated,
                    created_at, updated_at, deleted_at
                    -- amount/unit AS WRITTEN; base-unit conversion is core's job
ratings             id, family_id, recipe_id, family_member_id, score, rated_at,
                    created_at, updated_at, deleted_at
                    -- score 1-5, matching the product's five-point scale, which
                    -- the "whole family likes it" filter needs
                    -- one live rating per member per recipe (partial unique index)
                    -- family_member_id -> family_members (id, family_id): a
                    -- rating cannot be attributed to another household's person
meal_plans          id, family_id, week_start, created_at, updated_at, deleted_at
plan_entries        id, family_id, meal_plan_id, date, recipe_id, scale, cooked_at,
                    created_at, updated_at, deleted_at
                    -- recipe_id NOT NULL: an entry is a planned recipe. Free-text
                    -- entries would need it nullable and nobody has asked yet.
shortlist_entries   id, family_id, week_start, recipe_id,
                    created_at, updated_at, deleted_at
pantry_items        id, family_id, ingredient_id?, name, amount, unit,
                    created_at, updated_at, deleted_at
photos              id, family_id, recipe_id, storage_path, upload_state, source,
                    width, height, created_at, updated_at, deleted_at
                    -- source in (import|camera|upload)
                    -- storage_path names an object in the private `recipe-photos`
                    -- bucket. Storage read policies resolve through this column, so
                    -- an object with no row here is reachable only by the service
                    -- role — which is the correct state for an import awaiting
                    -- review. anon sees a photo only when the recipe is published
                    -- and source = 'camera'.
                    -- Because those policies trust this row and clients write rows:
                    -- CHECK (storage_path like family_id || '/%') and UNIQUE
                    -- (storage_path). Without them a household could name another
                    -- household's object and read it (decisions §25).
                    -- upload_state pending|stored: a photo taken offline reserves
                    -- its path at capture and uploads later. Never consulted by a
                    -- policy — the path authorises, the state is for the uploader.
import_jobs         id, family_id, kind, input_ref, status, result_json, error,
                    attempts, claimed_at, worker, quota_consumed_at, finished_at,
                    created_at, updated_at, deleted_at
                    -- kind in (url|text|screenshot|video)
                    -- status includes 'review': no import saves unseen, so the runner
                    -- finishes here and creates no recipe rows
                    -- claimed atomically by public.import_claim_next_job with
                    -- FOR UPDATE SKIP LOCKED; claimed_at doubles as a lease so a dead
                    -- worker's job returns to the queue, and attempts makes a poison
                    -- message visible
                    -- quota_consumed_at stops a retry charging twice
                    -- result_json holds the typed ImportFailure, not a message
```

**The catalog** — global reference data, no `family_id`. Readable by any signed-in
user, writable only by the service role that seeds it.

```
ingredients         id, key, canonical_name, aliases[], aisle, dimension,
                    grams_per_cup?, can_size?, created_at, updated_at
                    -- key is the domain's stable identifier ('heavy-cream') and
                    -- surfaces as ShoppingLine.key, so it must outlive a
                    -- canonical_name correction. Not a slug of the display name:
                    -- key 'butter' carries canonical_name 'unsalted butter'.
                    -- dimension mirrors the Dimension union in packages/core
                    -- grams_per_cup and can_size are what let a volume measure
                    -- merge into a weight-sold item, and "1 can" become a weight
grocery_packages    id, ingredient_id, label, base_amount, sort_order,
                    created_at, updated_at
                    -- base_amount in base units: "pint (16 oz)" = 473.176
                    -- UNIQUE (ingredient_id, label) makes re-seeding an upsert
```

Seeded from `SEED_CATALOG` by `packages/db/supabase/seed.sql`, which is
**generated** by `scripts/generate-seed.ts` and never hand-edited — 55 ingredients,
97 package sizes. `db reset` applies it, and re-running it upserts rather than
duplicating. A round-trip test rebuilds the catalog from these two tables and
asserts it consolidates a known week byte-identically to `createCatalog(SEED_CATALOG)`;
`scripts/check-seed-catalog-usage.mjs` fails the build if anything outside seeding
and tests references the constant.

**The cache** — belongs to nobody.

```
import_cache        url_hash PK, extracted_json, photo_path, fetched_at,
                    created_at, updated_at
                    -- no family_id, no policies, no client grant. url_hash is the
                    -- primary key rather than a UUID because this table is never
                    -- synced to a device and the hash is what makes it a cache.
```

### Three decisions worth calling out

**Every app row carries `family_id`,** enforced by row-level security. Household isolation is a database guarantee, not application logic you have to remember.

**The grocery catalog becomes data.** In the prototype, "cream comes in half-pints, pints and quarts" is hardcoded. As a table it can be corrected, extended and eventually improved by aggregate usage. This is what makes the shopping list get smarter over time instead of frozen.

**`import_cache` is keyed by URL, not by family.** A recipe that goes round Facebook gets fetched and parsed once for your entire user base. At subscription scale this matters more than model choice.

### Two things learned applying this

**Grants are a separate gate from RLS, and Supabase no longer opens it for you.** Postgres checks table privileges *before* row-level security. On the current Supabase image the default privileges for the `postgres` role — which is what migrations run as — grant client roles only `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` and **no DML at all**. Tables come out unreadable by `authenticated`, which fails closed: the schema looks secure and the application is simply dead. Every grant is therefore explicit in the RLS migration.

**Postgres checks the new row of an `UPDATE` against `SELECT` policies.** Not only the UPDATE policy's `WITH CHECK`. While the SELECT policy stays restrictive it masks the UPDATE policy entirely — weakening UPDATE alone changes no observable behaviour. That redundancy disappears the moment public recipe pages loosen a SELECT policy, at which point the UPDATE policy becomes the only guard. `packages/db/scripts/mutate-rls.sh` pins both behaviours.

---

## 6. The platform seam

Every app call goes through `platform-client`. It exposes roughly:

```ts
getSession()                  → account, family, members
getEntitlement(appKey)        → tier, quota, validUntil
consumeQuota(appKey, n)       → allowed | exceeded
registerDevice()              → deviceId
```

### Entitlement token

You cannot call a licence server from a supermarket basement. So entitlements travel as a **signed token** carried on the device:

```json
{
  "family_id": "...",
  "members": [{ "id": "...", "name": "...", "is_child": true }],
  "entitlements": { "recipes": { "tier": "full", "imports_remaining": 340 } },
  "valid_until": "2026-09-14T00:00:00Z",
  "grace_until": "2026-09-21T00:00:00Z"
}
```

Refreshed opportunistically whenever there's signal. Between `valid_until` and `grace_until` the app keeps working and nags. After grace, it degrades to read-only rather than locking — a family should never lose access to their own recipes because a card expired mid-shop.

Device limits are enforced at sign-in against the `devices` table, not on every action.

The seam is reached over HTTP by anything that cannot hold the service role — which is
every client. `packages/platform-client` exposes a framework-agnostic router
(`/session`, `/entitlement/:appKey`, `/entitlement/:appKey/quota`, `/devices`) plus a
Fetch adapter, so a Next.js route handler and a Phase 3 native host share one
implementation. The caller authenticates with its Supabase JWT and the account is
resolved from it; **no route accepts an `accountId`**, which is what stops one token
acting for another account.

### As built

*Implemented in `packages/platform-client`. If this and the code disagree, the code is right.*

The wire format is `pashki1.<keyId>.<payload base64url>.<signature base64url>`, signed **Ed25519**.

- **No algorithm field.** The verifier knows the algorithm. A token that names its own is how JWT implementations end up accepting `alg: none`, or being talked into checking an RSA signature with an HMAC key.
- **Asymmetric, not an HMAC**, so app #2's server can verify a platform-issued token while holding only a public key. A shared secret would mean anything that can verify can also mint.
- **Keys addressed by id**, so a rotation can complete: a verifier holds several public keys while tokens from the retired one are still inside grace. An unknown key id is refused rather than searched for.
- **Grace is not a column.** `entitlements` stores `valid_until`; the grace window is policy applied by the client (default 7 days) and carried in the token. Changing it needs no migration.
- **Window boundaries are inclusive** — valid *until* means the instant itself still counts.
- **Payload carries display names only.** No emails, no ratings; a leaked token must not become a privacy incident.

Access is `full` → `grace` → `read-only`, with deliberately no fourth state. `Access.canRead` is an always-true field rather than an absence, so introducing a lock would be a visible change to the type rather than something that slips in behind a boolean.

**Quota is server-authoritative.** The token's balance is a snapshot for offline display. Spending goes through `public.platform_spend_quota`, a service-role-only function doing one conditional `UPDATE` — read-then-write would let two devices both spend the last import and leave numbers that still looked plausible afterwards.

The seam is a port: `PlatformStore` is the only interface that knows platform tables exist, with a Supabase implementation and an in-memory one the tests drive the client through. Extraction for app #2 is writing another implementation, not touching callers. `scripts/check-platform-tables.mjs` fails the build if anything outside the seam queries a platform table.

### Fair-use quota — do this from day one

A flat subscription against variable AI cost is an unbounded liability. One enthusiastic user importing 400 saved reels in a weekend costs real money. Put an import quota in the entitlement token now; adding one later is nearly impossible without upsetting people. Generous is fine — a ceiling that only abuse touches.

---

## 7. Import pipeline

Everything funnels into a review step. **No import ever saves without the user seeing it.** This is what allows cheap models to be good enough.

```
       ┌─ URL ──────► Tier 0: structured recipe data on the page      FREE
       │                └─ miss ► Tier 1: microdata / plugin markup   FREE
       │                     └─ miss ► Tier 2: LLM on page text        ¢
       │
Input ─┼─ pasted text ────────────► Tier 2: LLM                        ¢
       │
       ├─ screenshots ───────────► Tier 3: vision                     ¢¢
       │
       └─ video file ────────────► Tier 4: media pipeline (§9)        ¢¢
                                        │
                                        ▼
                            core: parse lines → units → catalog match
                                        │
                                        ▼
                              REVIEW SCREEN → save
```

**Tier 0 is the whole game.** Most established recipe sites publish their recipe as structured data. Server-side there's no CORS, no blocked images, no relays. Read it directly, extract the photo, done — free and more accurate than any model.

Two hard-won details from the prototype, both worth carrying forward:

- Recipe image fields are frequently *references* into the page's data graph rather than URLs. Resolve them; don't try to download the pointer.
- The image index must not let a bare reference overwrite the real node it points at.

**Social links (Facebook, Instagram, TikTok) never resolve.** Detect and reject them immediately with a route to screenshots or video rather than making the user wait through four doomed attempts.

---

## 8. AI layer

### Routing

| Task | Model | Notes |
|---|---|---|
| Page/caption extraction | GPT-5.6 Luna | ~$0.20/$1.20 per 1M, cached input ~$0.02 — prompts are near-identical so cache hit rate is high |
| Fallback / independence | GPT-OSS 120B on Together | ~$0.15/$0.60, US-hosted open weights |
| Escalation on schema failure | Claude Haiku 4.5 → Sonnet 5 | Only on validation failure |
| Vision (screenshots, frames) | Gemini Flash-Lite or Claude Haiku | Low volume, hardest input |
| Transcription | Groq Whisper-v3 (~$0.04/hr) or AssemblyAI Universal-2 (~$0.15/hr) | |

Cost per 1,000 text imports lands around **$1.10–1.70**. Against a subscription business this is a rounding error — the reason to run cheap models is tail abuse, not the average.

### Non-negotiables

**Constrained JSON output.** Use each provider's schema-enforced mode. A small model with a grammar constraint beats a large one asked politely.

**One provider interface in `packages/import`.** The model becomes a config value, not a rewrite. The landscape moved materially in six months; assume it will again.

**Build the eval set before choosing anything.** 50–100 real captions, pages, screenshots and reels with hand-checked expected output. Without it, "performance relative to cost" is not something you can manage, and you won't notice the day a provider silently changes a model.

### Data residency

Prompts carry recipe content only — page text, captions, food photos. Names, emails, children's names and ratings never leave Postgres. This scopes the compliance question correctly: **database residency is what matters; model choice is procurement preference.**

Get in writing before signing: zero data retention, no training on your data, US-only processing and sub-processors, SOC 2 Type II, signed DPA.

---

## 9. Media pipeline (audio + video)

A reel splits the recipe across three places. Fusing them beats any single source:

| Source | Contributes |
|---|---|
| Narration | Method — "sear it skin-side down, don't touch it" |
| On-screen text | Amounts — this is where quantities actually live |
| Caption / pinned comment | Title, often the full ingredient list |

**Flow:** video file → ffmpeg worker → audio track + sampled frames (scene-change detection, favour frames containing text) → transcription + OCR in parallel → fusion call → `core` parsing → review screen → push notification.

Roughly **2¢ per reel**; a 20-minute video stays under a nickel.

### Ingestion: file, not URL

The share sheet hands you a *link*, not a video. Pulling media from that link server-side runs against the terms of service of all three platforms — a genuine business risk for a paid product under a company name, and a maintenance treadmill as platforms change defences.

**Build the file path instead.** The user saves the video to their camera roll (TikTok permits it where creators allow; screen recording covers the rest), then shares the file. Identical pipeline, one extra tap, no scraping infrastructure.

The same code gives you something better for a *family* recipe app: **film a relative cooking, get a structured recipe.** No terms of service anywhere near it.

Audio is where amounts go to die — "a splash of cream, hit it with parm". The estimated-amount flagging built in the prototype becomes essential here, not optional.

---

## 10. Sync & offline

This is the highest-risk part of the build. Treat it accordingly.

- **Local SQLite is the source of truth on device.** The UI never waits on the network.
- **Use a sync engine.** Do not hand-roll replication.
- **Last-write-wins per row is genuinely adequate here.** Two people rarely edit the same recipe in the same minute. Resist building conflict resolution theatre.
- **Server-authoritative regardless of sync:** entitlements, quota consumption, device registry.
- **Deleted rows need tombstones,** or a recipe deleted on one phone reappears from another.

Before committing, check the maintenance health and funding of whichever engine you pick. Migrating sync engines mid-project is brutal.

---

## 11. Cost

**While it's just your family:** effectively free. Vercel Hobby and the Supabase free tier cover four people many times over; AI runs to pennies. Budget a domain and call it £1–2/month. Note Hobby is non-commercial only, and hitting a limit pauses the deployment rather than billing you.

**At launch:** Vercel Pro (~$20) + Supabase Pro (~$25) + Apple Developer ($99/yr) ≈ **$50/month**, break-even around six subscribing families. AI remains a rounding error well past that.

**At scale:** the levers, in order of impact — Tier 0 hit rate, `import_cache` hit rate, then model choice. In that order, not the reverse.

---

## 12. Security, privacy, compliance

- **Row-level security on every app table,** keyed on `family_id`.
- **Account deletion in-app** — required before Apple will approve.
- **Privacy policy and DPA** before public signup.
- **Copyright posture.** Ingredient lists and instructions aren't strongly protectable; a blogger's photos and written prose are. Attribute clearly, link back, honour takedowns, don't reproduce headnotes. Personal-use copying and a public product that stores others' food photography are different postures. Decide deliberately.
- **Apple's outside-purchase rules.** A subscription sold on pashkilabs.com that unlocks an iOS app runs straight into these. There is a legitimate multiplatform path, but the details are strict and have moved repeatedly. **Validate against Apple's live guidelines before building the billing flow** — it can dictate the whole design.

---

## 13. Delivery plan

### Phase 0 — Domain package *(start here)*
Extract parser, unit conversion, catalog matching and package maths into `packages/core`. Real test suite. Build the AI eval set. **No UI. No infrastructure.** This is the only code in the prototype that's hard to rebuild, and everything else depends on it.

### Phase 1 — Foundations
Supabase schema and RLS. Thin platform: auth, family, one entitlement, Stripe. `platform-client` with the seam properly drawn. Seed the ingredient catalog.

### Phase 2 — Web app
Port the prototype's screens to Next.js. Server-side import service — Tiers 0–3. Public recipe pages. Photo pipeline. **Ship this and use it as a family for a month before writing native code.**

### Phase 3 — Native
Expo app, local SQLite, sync engine. Share target. Camera. Cook mode. Shopping list. RevenueCat. TestFlight far earlier than feels comfortable.

### Phase 4 — Media
ffmpeg worker, transcription, frame OCR, fusion, push notification.

### Phase 5 — Platform extraction
Generalise what app #2 actually needs. Not before.

---

## 14. Open decisions

| Question | Why it's blocking |
|---|---|
| Apple's current outside-purchase rules | Could dictate the entire billing architecture |
| Sync engine | Highest-risk dependency; verify maintenance health first |
| Copyright posture on imported photos and prose | Changes what you store and display |
| Free tier, trial, or paid-only | Affects quota design and cost exposure |

---

## 15. Immediate next steps

1. **Export the prototype data** so nothing is stranded.
2. **Stand up the monorepo** and extract `packages/core` with tests.
3. **Build the eval set** — 50 real recipes across URLs, captions, screenshots and reels.
4. **Check the Apple rules** before designing billing.
5. **Move to Claude Code**, working against the real repository rather than chat artifacts.

---

*Pricing figures are an August 2026 snapshot and moved materially over the preceding six months. Re-verify at contract time.*
