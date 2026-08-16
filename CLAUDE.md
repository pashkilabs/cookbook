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

pnpm --filter @pashki/web dev          # the app, against whatever .env.local points at
```

Against the hosted project. All need `set -a && . ~/.pashki-supabase.env && set +a`
first, and all must be run from `packages/db` — the CLI takes its project id from the
working directory. Each reports three outcomes with distinct exit codes.

```bash
pnpm --filter @pashki/db db:push:dry            # always before db:push
pnpm --filter @pashki/db db:push
pnpm --filter @pashki/db check:parity           # always after; schema, privileges, auth
pnpm --filter @pashki/db set:smtp               # mail provider for hosted auth
pnpm --filter @pashki/db set:site-url <url>     # site_url + redirect allow list, together
pnpm --filter @pashki/db issue:entitlement --email <address>
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
docs/deployment.md     what is deployed where, and what is configured by hand
docs/on-device.md      what a device holds and enforces, and what sync must give us
docs/roadmap.md        phases and current position
```

`packages/core`, `packages/db`, `packages/platform-client`, `packages/import` and
`apps/web` exist. `packages/ui`, `apps/mobile`, `apps/api` and `apps/worker` do not.
`apps/web` is **deployed** at `https://cookbook.pashki.com` against the hosted Supabase
project — see `docs/deployment.md` for what is configured where, and `docs/roadmap.md`
for what's next. Public recipe pages have schema and policies but nothing renders them.

Three boundaries are enforced by `pnpm check:boundaries`, not by good intentions:

- `check-platform-tables.mjs` — nothing outside `packages/platform-client` (or
  `packages/db`, which owns the schema) may query a platform table.
- `check-seed-catalog-usage.mjs` — nothing outside seeding and tests may reference
  `SEED_CATALOG`.
- `check-server-only.mjs` — no `"use client"` file or `apps/mobile` file may import
  the seam, the import package or an inference credential.
- `check-native-imports.mjs` — no native module (`sharp` and friends) at module scope
  in `apps/web`. A written trap did not prevent this twice; a build does.

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

**Package sizes are per market.** A pint is 473 ml and a metric carton is 500, so
`grocery_packages.system` splits them and nothing may mix two markets in one purchase
(decisions §28). Display follows `families.measurement_system`, not the recipe's units and
not the catalog's.

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
- **`ON DELETE CASCADE` does not fire on a soft delete.** Every deletion here is an `UPDATE`
  setting `deleted_at`, because clients hold no `DELETE`, so a cascade declared on a foreign key
  never runs — a tombstoned recipe kept its plan entries and went on buying ingredients.
  Propagation is a trigger (`private.propagate_soft_delete`, decisions §30) rather than route
  code, because Phase 3's sync writes `deleted_at` straight into Postgres from a device and never
  calls a route. Children take the parent's *exact* timestamp, which is what makes an undelete
  distinguishable from a child deleted on its own.
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
- **A smoke check that calls an endpoint proves the endpoint, and nothing else.** It is
  not evidence a feature exists and must never be allowed to stand in for one. Two of
  the last three things built — caption paste and screenshot upload — had **no way in
  from the product** while their checks were green: the checks called the route, the
  scripts called the route, and a person opening the app could not find either. The
  import screen still offered only "One link" and "A whole folder". "Verified against
  production" was true and meaningless. A feature is reachable from a screen; until it
  is, say plainly that an endpoint exists and the feature does not.

- **`git status` cannot tell you what has been committed.** It describes the working
  tree and nothing else, so a dirty tree at the end of a session says nothing about
  whether previous sessions landed. Run `git log` before any claim about repository
  state. The failure this prevents: reporting an escalating count of uncommitted
  sessions across ten sessions that had each been committed at the time.
- **A test that computes a time boundary here and compares it in the database is
  racing two clocks.** The local Postgres container measured **120–150 ms ahead of the
  host**, so `grace_until = Date.now() - 1` — one millisecond in our past — was a tenth
  of a second in *its* future, and a lapsed household was still inside its grace window.
  The write succeeded, the guard test failed, and it passed whenever the round-trip
  happened to outlast the skew. It read as flake. **Set the boundary with the database's
  own `now()`** so one clock writes it and evaluates it; widening the offset hides the
  race instead of removing it. Anything within a second of a boundary is suspect.
- **A migration's self-check only knows what its own version knew, so `check:parity`
  passing is not evidence that a newer invariant landed.** The invariants are one
  function that each migration replaces; an environment running the *older* body
  passes its own checks happily while missing the rule entirely, and parity compares
  answers rather than versions. So "parity is green" can mean "both environments
  agree, and one of them has never heard of the rule you are asking about."
  **Verify a specific migration by attempting the thing it forbids** — the read it
  revokes, the write it blocks — not by reading `schema_migrations` and not by
  trusting parity. And check the attempt could have succeeded: a probe that would
  report REFUSED against an empty database has measured nothing.
- **A deployment is not the sum of its migrations, and a green build proves only that
  it compiled.** Every route importing `sharp` returned 500 from the day it shipped —
  a native addon webpack cannot bundle, which resolves locally because the darwin
  binary is sitting in `node_modules` anyway. The build passed, the tests passed,
  parity passed. What found it was calling the routes. Two lessons stuck: a **500 is
  never an acceptable answer** where 401 would do, because it means no handler ran;
  and **module-scope imports decide a route's blast radius** — one route wanted a
  bucket *name* from a module that imports an image library, and died for it. Load
  heavy or native things inside the function that needs them.
- **A native module needs to be excluded from the bundle *and* traced into the
  function; doing only the first ships it broken.** `serverExternalPackages: ["sharp"]`
  correctly stops webpack bundling a `.node` binary — and then the file has to arrive by
  file tracing instead, which cannot see the dynamic `require("@img/sharp-<platform>")`
  sharp uses. The deployed function had sharp and not its binary:
  `Could not load the "sharp" module using the linux-x64 runtime`. Fixed with
  `outputFileTracingIncludes`, plus `outputFileTracingRoot` at the monorepo root because
  tracing does not climb out of the app directory. None of it reproduces locally, where
  the darwin binary is in `node_modules` for Node to find regardless.
- **A shared secret set on both sides can still be two different secrets.** The scheduler
  called the drain route every minute and got `401 sign in first` while every presence
  check said the secret was configured. Presence is not agreement, and neither is
  "I pasted it twice". `/api/health` publishes a 12-hex SHA-256 fingerprint so the copies
  can be *compared*; the same reasoning says a health check reporting `tokenSigner: true`
  for a PEM that cannot be parsed is reporting the wrong thing.
- **A route with two doors needs both tested.** `pnpm smoke` was green about
  `/api/import/drain` while the queue never drained: smoke called it with a session and
  the scheduler calls it with a shared secret. One door worked.
- **Verifying a flow does not verify the flows beside it.** Signup, confirmation and
  provisioning were proven end to end against production while every import route was
  broken, because provisioning goes through the store and never touches the signer or
  the image pipeline. Two whole subsystems — the seam's HTTP surface and imports —
  were dead on a deployment that had been "verified end to end". `pnpm smoke` exists
  to make that specific mistake harder: it exercises every route class, and treats any
  500 as a failure.
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
