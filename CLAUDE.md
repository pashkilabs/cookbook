# Pashki — project memory

Read this first. It encodes decisions already made, so they don't get relitigated.

## What this is

**Pashki Labs** sells one family subscription that unlocks a portfolio of apps.
The **recipe app** is tenant #1. It captures recipes from anywhere on the
internet, learns who in a household likes what, plans a week of meals, and
produces a shopping list that consolidates ingredients across recipes — so you
buy one pint of cream and it's split across Tuesday and Friday, not two
half-pints and waste.

Public product, open signup. iOS, Android and web. Must sync across devices and
work with no signal.

## Commands

```bash
pnpm install
pnpm check                      # boundaries + typecheck + test, everything
pnpm check:boundaries           # the two import guards on their own
pnpm test                       # all packages
pnpm --filter @pashki/core test # one package
pnpm --filter @pashki/core eval # extractor accuracy against the fixture set

pnpm --filter @pashki/db db:start      # local Supabase (needs Docker)
pnpm --filter @pashki/db db:reset      # re-apply every migration, then seed
pnpm --filter @pashki/db gen:types     # regenerate database.types.ts
pnpm --filter @pashki/db gen:seed      # regenerate seed.sql from SEED_CATALOG
pnpm --filter @pashki/db test:mutate   # prove the RLS tests would catch a hole
```

Run `pnpm check` before saying a task is done. Database tests skip themselves when
no local Supabase is running, so a green `pnpm check` without Docker has covered
less than it looks — run `db:start` first when touching schema or the seam.

After any migration: `db:reset` then `gen:types`, and commit the regenerated
types. They drift silently otherwise.

## Layout

```
apps/web/        Next.js — marketing, signup, public recipe pages, planner
apps/mobile/     Expo — share target, camera, shopping, cook mode
apps/api/        import service, webhooks, entitlement issuance
apps/worker/     ffmpeg container — audio + frame extraction
packages/core/         ⭐ parser, units, package maths, consolidation
packages/platform-client/ ⭐ the seam: auth, family, entitlements, quota
packages/import/       readers, extractors, AI cascade, fusion
packages/ui/           design tokens, shared primitives
packages/db/           schema, migrations, generated types
docs/architecture.md   full design
docs/decisions.md      what was chosen and what would reverse it
docs/roadmap.md        phases and current position
```

`packages/core`, `packages/db` and `packages/platform-client` exist. Everything
else in that tree is still a plan. See `docs/roadmap.md` for what's next.

Two boundaries are enforced by `pnpm check`, not by good intentions:
`scripts/check-platform-tables.mjs` fails if anything outside
`packages/platform-client` (or `packages/db`, which owns the schema) queries a
platform table, and `scripts/check-seed-catalog-usage.mjs` fails if anything
outside seeding and tests references `SEED_CATALOG`.

## Rules that matter

**Deterministic before AI.** Most recipe sites publish machine-readable recipe
data. Read it — free, instant, more accurate than any model. AI is the fallback
tier, never the first attempt. This is the main cost and reliability lever.

**Never call an inference API from the browser or the app.** Server-side only.
Keys must never reach a client bundle.

**Prompts carry recipe content only.** Never names, emails, children's names or
ratings. Personal data stays in Postgres. This is what keeps the compliance
surface small — don't erode it for convenience.

**US-hosted inference only.** See `docs/decisions.md` for the routing table.

**The app never touches platform tables directly.** No queries against
`accounts`, `families`, `subscriptions` or `entitlements` from app code — go
through `packages/platform-client`. This boundary is what makes extracting a
real platform for app #2 mechanical rather than surgical.

**`family_members` are not `accounts`.** Adults have logins; children are rated
but never sign in. Keep them separate, linked optionally.

**Every app table carries `family_id`,** enforced by row-level security.

**The grocery catalog is data, not code.** `SEED_CATALOG` is seed data for the
`ingredients` and `grocery_packages` tables. Build catalogs via
`createCatalog(items)`. Nothing may import `SEED_CATALOG` outside seeding and
tests.

**Base units are millilitres and grams.** Convert on the way in, format on the
way out. Never do arithmetic on written units.

**Every import passes a review screen before saving.** This is what lets cheap
models be good enough. Do not add a silent-save path.

## Traps already hit — don't rediscover these

- **A browser cannot fetch other websites.** CORS and CSP block it, and public
  relays are unreliable. All page and image fetching happens server-side. Most
  of the prototype's complexity existed to work around this; it should not
  survive into production.
- **Recipe image fields are often references, not URLs.** Sites commonly write
  `"image": {"@id": "...#primaryimage"}` pointing elsewhere in the page's data.
  Resolve the reference; don't try to download the pointer. And when indexing
  that data, a bare reference must not overwrite the real node it points at.
- **Don't trust content types from proxies.** Validate an image by decoding it,
  not by what the response claims to be.
- **Facebook, Instagram and TikTok links never resolve.** Detect and reject them
  up front with a route to screenshots or video — don't let a user wait through
  four doomed attempts.
- **`T` is a tablespoon, `t` is a teaspoon.** Don't lowercase before resolving
  units. There is a regression test for this.
- **Use inline confirmation, not `confirm()`.** Better on mobile, and it can't
  be suppressed by an embedding context.
- **Postgres checks table privileges before row-level security.** A new table
  needs an explicit grant to `authenticated`, and to `service_role` — which
  bypasses RLS but still needs privileges; those are not the same thing. Without
  the grant everything fails closed while the schema looks correct. Current
  Supabase images deliberately narrow the default ACL so user tables aren't
  auto-exposed, so don't expect one to arrive on its own.
- **To test an RLS policy, make it permissive — don't remove it.** RLS denies by
  default, so a dropped policy makes the table *more* restrictive and the
  isolation test passes for the wrong reason. See `packages/db` `test:mutate`.
- **A PostgREST bulk insert ignores column defaults.** It sends the union of the
  keys across every row in the batch and passes NULL for whatever a row omits, so
  a row that leaves out a column with a default gets NULL rather than the default
  — and a NOT NULL column fails outright. Spell out every column on every row of a
  batch.
- **Postgres checks the new row of an `UPDATE` against `SELECT` policies.** An
  UPDATE policy can therefore sit redundant behind a restrictive SELECT policy
  and look tested when nothing is exercising it. Loosening a SELECT policy — for
  public recipe pages, say — promotes that UPDATE policy to the only guard.

## Style

TypeScript strict everywhere, `noUncheckedIndexedAccess` on. Prefer pure
functions over classes. Comments explain *why*, not *what* — if a line needs a
comment to say what it does, rename something instead.

Tests carry the reasoning: name them as behaviour (`"buys loose produce
individually instead of forcing a multipack"`), and when fixing a bug, add the
test before the fix and mark it `// regression:`.

Don't add dependencies to `packages/core`. It stays pure — no DOM, no network,
no framework — so it runs identically in Next.js, Expo and the worker.

## Open questions — don't design around these without checking

1. **Apple's outside-purchase rules.** A subscription sold on pashkilabs.com
   unlocking an iOS app is governed by rules that have moved repeatedly. Verify
   against Apple's live guidelines before building the billing flow.
2. **Sync engine choice.** Highest-risk dependency. Check maintenance health and
   funding before committing.
3. **Copyright posture** on imported photos and prose.

If a task requires one of these to be settled, stop and say so rather than
guessing.
