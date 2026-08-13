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
pnpm check:boundaries           # the three boundary guards on their own
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
docs/on-device.md      what a device holds and enforces, and what sync must give us
docs/roadmap.md        phases and current position
```

`packages/core`, `packages/db`, `packages/platform-client` and `packages/import`
exist. Nothing under `apps/` does yet. See `docs/roadmap.md` for what's next.

Three boundaries are enforced by `pnpm check:boundaries`, not by good intentions:

- `check-platform-tables.mjs` — nothing outside `packages/platform-client` (or
  `packages/db`, which owns the schema) may query a platform table.
- `check-seed-catalog-usage.mjs` — nothing outside seeding and tests may reference
  `SEED_CATALOG`.
- `check-server-only.mjs` — no `"use client"` file or `apps/mobile` file may import
  the seam, the import package or an inference credential.

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

**The app never touches platform tables directly.** No queries against `accounts`,
`families`, `family_members`, `devices`, `subscriptions` or `entitlements` from app
code — go through `packages/platform-client`, over HTTP if the caller cannot hold the
service role. This boundary is what makes extracting a
real platform for app #2 mechanical rather than surgical.

**`family_members` are not `accounts`.** Adults have logins; children are rated
but never sign in. Keep them separate, linked optionally.

**Every app table carries `family_id`,** enforced by row-level security.

**The grocery catalog is data, not code.** `SEED_CATALOG` is seed data for the
`ingredients` and `grocery_packages` tables. Build catalogs via
`createCatalog(items)`. Nothing may import `SEED_CATALOG` — or `METRIC_PACKAGES`,
`seedCatalogFor`, `metricPackageCoverage` — outside seeding and tests.

**Catalog names are singular; the display pluralises.** `formatCountable` and `pluralise`
handle count nouns with an irregulars list, because storing "lemons" fixes "3 lemons" and
breaks "1 lemon". Plurals live in `names` as aliases, since that is what recipes are written
in.

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
- **Silence reads as success.** Any check that can produce *no* result must
  distinguish "no result" from "passed", or an unusable run looks like a clean one.
  This has bitten twice: a mutation harness treating zero matched tests as a pass,
  and instance discovery skipping every integration test because the API had not
  finished restarting. Two rules follow. A check reports three outcomes, not two —
  passed, failed, and could-not-measure, with different exit codes. And a skip that
  infrastructure timing could have caused gets retried before it is believed.
- **Storage rows cannot be deleted with SQL.** A `storage.protect_delete()` trigger
  refuses direct deletes from `storage.buckets` and `storage.objects` to stop objects
  being orphaned, so cleanup goes through the Storage API — `.remove()` for objects,
  the bucket endpoint for buckets. Found when a probe bucket would not go away and
  the migration could not tidy up after itself.
- **`turbo run test` must not be cached, and is not.** Most suites here assert against
  a real Postgres, and the database is an input turbo cannot hash — so a cache hit
  replays a pass that was measured against a different schema. Three attempts to
  reproduce the post-reset flake reported clean because they were replays of an earlier
  run. If `pnpm check` ever gets fast enough to be suspicious, check `cache: false` is
  still on the `test` task.
- **RLS decides what may leave the database; a screen decides whose kitchen it shows.**
  Those are different questions and only the first is a policy's job. Published recipes are
  world-readable by design (decisions §17), so a household-scoped view **must filter by
  `family_id` itself** — relying on RLS for presentation means the view shows everything the
  person is *permitted* to see, which is not the same as everything that is theirs. Found
  when the recipe list rendered another household's published roast chicken, with every
  policy behaving exactly as intended.
- **The local stack and hosted also disagree about email confirmation, in the other
  direction.** Hosted ships `mailer_autoconfirm: false` — confirmation required. The CLI ships
  `enable_confirmations = false` — auto-confirm. So local is the *more permissive* of the two
  here, and every negative test about unconfirmed accounts passes vacuously until
  `supabase/config.toml` is fixed. Neither environment is reliably stricter than the other;
  they simply differ, and `config.toml` has to be read against the hosted config rather than
  trusted. `pnpm --filter @pashki/db check:parity` compares schema and privileges, **not auth
  settings** — nothing automated catches this one yet.
- **GoTrue matches `redirect_to` against its allow list, and a path under `site_url` is not
  implied.** An unlisted redirect is not an error: it is silently replaced with `site_url`, so
  the link in the email goes somewhere plausible and wrong. Add the path glob
  (`http://host:port/**`) to `additional_redirect_urls` locally and `uri_allow_list` on hosted.
  And build that URL from configuration, never from the request's `Host` header — a Host is
  attacker-controlled, and an email built from one is a poisoned confirmation link.
- **Hosted Supabase and the local image disagree about what "default" means.** Hosted
  runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,
  authenticated`, so a new table is born with full DML for anonymous clients. The local
  image narrows the same ACL to `Dxtm` and grants no DML at all. **Every migration is
  therefore written and tested against a stricter environment than production**, and a
  local-only green is not evidence that the grant matrix is right. Any migration adding
  a table must revoke client privileges and re-grant explicitly, and assert the
  resulting matrix in a `DO` block — `pnpm --filter @pashki/db check:parity` compares the
  two environments and is the only thing that can catch the difference. Found when the
  first hosted push refused itself: `import_cache`, one shared row set for the whole
  user base, was readable by `anon`, with only RLS between a stranger and the catalog.
- **Row-level security says nothing about columns.** A policy decides which *rows* a
  caller may write; a table-wide `INSERT`/`UPDATE` grant then lets it write every
  column of those rows. Correct policies therefore coexisted with a client able to set
  its own quota accounting, rewind the import queue, relabel a photograph's provenance
  and stamp its own `updated_at`. Ask what a row can *assert*, not just which rows are
  reachable — and grant columns, not tables (decisions §26).
- **The Supabase CLI takes its project id from the working directory.** Run
  `supabase db reset` from the repo root and it looks for a container named after the
  root, reports `supabase start is not running`, and changes nothing. The instance is
  fine; the CLI is looking at the wrong name. Run it from `packages/db`. This cost a
  debugging detour because the error was filtered out by a `grep -E "ERROR"` — the CLI
  writes `"Error"` — which is the "silence reads as success" trap arriving through my
  own pipeline rather than through the tool.
- **`git status` cannot tell you what has been committed.** It describes the working
  tree and nothing else, so a dirty tree at the end of a session says nothing about
  whether previous sessions landed. Run `git log` before any claim about repository
  state. The failure this prevents: reporting an escalating count of uncommitted
  sessions across ten sessions that had each been committed at the time.
- **As `anon`, `select *` on a public recipe fails.** Public reads are limited by
  **column** grants as well as row policies, and asking for a column you cannot
  read is a permission error rather than a filtered subset. Public reads need an
  explicit column list. The error is the safe direction: a caller has to name what
  it wants.
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
