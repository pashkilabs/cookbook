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
| Queue | Inngest or Trigger.dev | Batch imports and media jobs are async by nature |
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

---

## 5. Data model

### Platform tables (Pashki-owned)

```
accounts            id, email, created_at, deleted_at
families            id, name, owner_account_id, created_at
family_members      id, family_id, account_id?, display_name, colour, is_child
                    -- account_id NULL for children who are rated but don't sign in
devices             id, account_id, platform, last_seen_at, revoked_at
subscriptions       id, family_id, provider, external_id, status, renews_at
entitlements        id, family_id, app_key, tier, quota_json, valid_until
```

**The critical split: `family_members` are not `accounts`.** Adults have logins. Children get rated but never sign in. The prototype stumbled onto this with its separate "eaters" list; here it's formalised. Every app in the portfolio inherits this family definition rather than asking users to rebuild it.

### App tables (recipe-owned)

```
recipes             id, family_id, title, source_url, source_name, servings,
                    time_minutes, status, make_again, times_made, created_by
recipe_ingredients  id, recipe_id, position, amount, unit, item_text,
                    ingredient_id?, note, is_estimated
ingredients         id, canonical_name, aliases[], aisle, dimension
                    -- the catalog, promoted out of source code
grocery_packages    id, ingredient_id, label, base_amount, sort_order
                    -- "pint (16 oz)" = 473ml
ratings             recipe_id, family_member_id, score, rated_at
meal_plans          id, family_id, week_start
plan_entries        id, meal_plan_id, date, recipe_id, scale, cooked_at
shortlist_entries   id, family_id, week_start, recipe_id
pantry_items        id, family_id, ingredient_id?, name, amount, unit
photos              id, recipe_id, storage_path, source, width, height
import_jobs         id, family_id, kind, input_ref, status, result_json, error
import_cache        url_hash, extracted_json, photo_path, fetched_at
```

### Three decisions worth calling out

**Every app row carries `family_id`,** enforced by row-level security. Household isolation is a database guarantee, not application logic you have to remember.

**The grocery catalog becomes data.** In the prototype, "cream comes in half-pints, pints and quarts" is hardcoded. As a table it can be corrected, extended and eventually improved by aggregate usage. This is what makes the shopping list get smarter over time instead of frozen.

**`import_cache` is keyed by URL, not by family.** A recipe that goes round Facebook gets fetched and parsed once for your entire user base. At subscription scale this matters more than model choice.

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
