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
pnpm --filter @pashki/db rotate:token           # replace SUPABASE_ACCESS_TOKEN — the one
                                                # command here that does NOT need the env
                                                # file sourced first, since it writes it
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
- `check-tests-run.mjs` — every `*.test.*` file is matched by a vitest config. A `.tsx`
  test outside a `*.test.ts` include ran nowhere and the suite reported the same count
  as before it existed: seven tests, counted, never executed.

## Rules that matter

**Deterministic before AI.** Most recipe sites publish machine-readable recipe
data. Read it — free, instant, more accurate than any model. AI is the fallback
tier, never the first attempt. This is the main cost and reliability lever.

**Never call an inference API from the browser or the app.** Server-side only.
Keys must never reach a client bundle.

**Prompts carry recipe content only.** Never names, emails, children's names or
ratings. Personal data stays in Postgres. This is what keeps the compliance
surface small — don't erode it for convenience.

**US-hosted inference only** — *enforced on vision, unverifiable on text.* Anthropic
takes `inference_geo: "us"` and **echoes it back in `usage`**, so the provider sends it
and refuses any answer that returns "global"; that half is checked rather than trusted.
Together's OpenAI-compatible API exposes no region parameter and returns no region field,
so the text tier's routing cannot be verified from a response and the rule is a
**documented intention there, not a guarantee** (decisions §53). Do not read this line as
satisfied for text.

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
- **A version stamp only works if somebody turns it.** `EXTRACTOR_VERSION` exists precisely
  so a fixed extractor expires cached answers written by the broken one — and it sat at `1`
  through two changes that altered the payload, so every cached URL kept serving recipes with
  an empty method. Its own doc says *"forgetting to bump costs every household a wrong recipe
  forever. When unsure, bump."* The mechanism was right and unused, which is a **different
  failure from a missing mechanism and reads identically from the outside**: the cache returns
  a confident, well-formed, stale answer. So when a change alters what an extractor produces,
  bumping is part of the change, not a follow-up — and record what each version *means*, since
  a bare integer gives the next reader nothing to compare against.

- **There was more than one cache, and only one of them had a version.** `EXTRACTOR_VERSION`
  governs the *import* cache and is the subject of the trap above. The **palate note** and the
  **component partition** are two further caches, keyed by `promptKey`, and nothing governed them
  at all — so the fix for the first cache did not protect the other two, and the next instance
  landed in the ones nobody had thought about.

  What made it invisible is that `promptKey` was **built to avoid exactly this**. Its comment
  reads: *"Derived from the input rather than bumped by hand, because a stamp only works if
  something turns it — and nobody turned EXTRACTOR_VERSION for two releases."* Correct about
  hand-stamps, and it then fingerprinted every input the *recipe* carries — title, lines,
  declared sections — while omitting **the prompt, which is also an input**. So rewriting the
  component instructions left every key byte-identical. Role-named parts went 8 of 9 → 0 of 10
  **in the eval** and reached no household: the stored partitions were still named `protein`,
  `garnish`, `carbohydrate` — the exact words the rewrite removed. A bug report of "splitting
  extracts the protein and ignores the sauce" was a report about a prompt that had been fixed a
  week earlier.

  Two rules, and the second is the one worth keeping. **Ask how many caches a change invalidates,
  not whether the one you remember is versioned** — the same question as *which files does nothing
  check?*, asked about stored answers. And **a derived key is only as good as its list of inputs**:
  the prompt is text and text can be fingerprinted, so `prompt-version.ts` hashes the instructions
  *and the schema* — a description is half the prompt, which §54a already proved by letting an
  example become a default. The digest is now the **first and required** argument to `promptKey`,
  because the thing that failed twice was a sentence in a comment, and a type error is a mechanism.

- **A permission nothing has exercised is a permission you do not have.** Every object
  in the photo bucket had been written by the import service as `service_role`, which
  **bypasses RLS entirely** — so `storage.objects` having no INSERT policy at all was
  invisible for months. Nothing was wrong until a client tried, and then everything was.
  The same family as *an endpoint answering is not a feature*: **a path that has only
  ever run with elevated privilege has not tested its permissions**, it has tested that
  privilege can skip them. So when a feature gives a client a write that only the service
  role has ever done, treat the policy as absent until something has actually written as
  that client — and put that write in a test, because it is the only thing that
  distinguishes "permitted" from "never asked".

- **Supabase Storage refuses with the *identical* wording a table refuses with.**
  `new row violates row-level security policy` names the mechanism, not the location —
  so an upload blocked by `storage.objects` reads exactly like one blocked by the table
  you were writing to. `public.photos` had a correct INSERT policy and correct column
  grants the whole time; `storage.objects` had one policy, `SELECT`, and RLS denies by
  default. **Check `pg_policy` on `storage.objects` as well as on the table.** The reason
  it was missing at all is the more general lesson: every object until then had been
  written by the import service as `service_role`, which bypasses RLS, so no
  `authenticated` write path had ever had to exist. **A permission nothing has exercised
  is a permission you do not have** — same class as the migration-ordering hazard, code
  shipped ahead of its database permission.

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
  trusted. **`check:parity` does now compare auth settings** — 26 of them, `mailer_autoconfirm`
  among them, via `scripts/auth-parity.mjs`, which translates the CLI's `enable_confirmations`
  into GoTrue's `GOTRUE_MAILER_AUTOCONFIRM` so the two environments are comparable at all. This
  line said the opposite for a while after the mechanism landed, which is the costlier direction
  for a note to rot in: **a memory claiming a gap that has been closed invites hand-checking what
  is automated, or building the mechanism twice.** The caveat that remains is narrower — the auth
  half needs `SUPABASE_ACCESS_TOKEN`, so it reports *could not measure* and exits 2 when the
  management token expires, and a half that cannot run is not checking. Rotate with
  `pnpm --filter @pashki/db rotate:token`.
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

  **The same blindness through data, which is the face that is easy to miss.** An *empty
  table cannot fail a constraint*, so a statement that only touches rows is untested
  wherever the rows are not. `update private.scheduler_config set drain_endpoint = null`
  passed locally and refused on hosted: the column has been `not null` since it was
  created, and locally there is **no row at all**, because that config is populated by
  `set:drain-endpoint`, which is a hosted operation. Zero rows matched, so nothing could
  fail.

  The privileges version of this is well known here and the data version reads as safe
  precisely because the statement is so ordinary. So: **a migration that writes rows is
  only tested where those rows exist**, and the environments differ in which rows exist as
  much as in what is granted. The fix is the one that worked — **assert the state
  afterwards**, in a `DO` block, because a no-op where there is no row is
  indistinguishable from a success. `check:parity` compares schema and privileges; it does
  not compare contents, and nothing does.

- **An example in a schema description is a silent default.** `COMPONENTS_JSON_SCHEMA`
  described a component's name as *"what a cook would call it — 'the sauce', 'guacamole'"*,
  and eight paragraphs of instruction said nothing about naming at all. So the field was
  **not empty — it echoed the example back**: a spicy mayo came back as `sauce`, a poke
  bowl as `sauce / protein / carbohydrate / vegetable`. Asking for a name outright, and
  replacing the example, moved it to `spicy mayo / marinated chicken / jasmine rice / poke
  bowl toppings` — 8 of 9 recipes role-named became 0 of 10.

  §54 is *a schema field is not a request*; this is the step along. **A field nobody asks
  for in words gets whatever the example suggests**, and a role word in an example teaches
  role words. So an example is a default: write ones that demonstrate the answer you want
  and never one that demonstrates the failure you are trying to prevent.

- **A proxy can rot without failing.** "Component names that are not a role word" was a
  sound measure of the naming problem — while the prompt was broken. The moment the prompt
  was fixed it became meaningless: `loaded potato soup` is not a role word and is also not
  a base, so a one-pan dinner named once passed it, and the line read 10 of 10 while the
  thing it was meant to measure had not moved at all.

  **Nothing would have flagged this.** The number did not break, it kept answering a
  question that had stopped being the question — and it was *my own* line, added two turns
  before. So when a fix lands, re-ask what every measurement of it is now measuring:
  **a proxy whose validity depends on a bug expires when the bug does.** The real question
  here was always "how many recipes have two or more parts", and the easy question had been
  standing in for the hard one.

- **Ask which files are *not* covered, because a tool cannot report on what it was never
  given.** `pnpm typecheck` ran five projects and reported success, and success there means
  "every file I was told about is fine" — it says nothing about a file outside every
  `include`. Sixteen were: **`eval.mts`**, which produces the accuracy numbers model choices
  rest on; **`generate-seed.ts`**, which writes `seed.sql`; and every measurement script,
  `ripeness` and `gate-curve` and `ab-consensus` among them. **A script that compiles as
  nothing can report confidently from broken code**, and two were already broken — `eval.mts`
  called `createImportExtractor` with options that do not satisfy its own type, and
  `pull-corpus.mts` read `.length` off an `unknown`. A syntax error in `ripeness.mts` had
  passed `tsc` entirely and was only caught by running it.

  Same family as `check-tests-run.mjs`, which asks which test files no vitest config will run.
  Both exist because the inverse question is the one with the answer in it: *which files does
  nothing check?* `scripts/check-typechecked.mjs` asks it on every build, by diffing
  `tsc --listFiles` against the tree, and is mutation-tested.

  **And the fix wanted a correction from the test suite.** Making `fetcher` optional, I wrote
  that the eval "always supplies its own" and replaced a caller's unconditionally. That broke
  the test driving the whole cascade over a stub: a caller *does* supply a working fetcher for
  a fixture with no capture. The claim was true of `eval.mts` and false of the type — which is
  what a type is for, and why widening a gate finds things that then need thinking about
  rather than just fixing.

- **A reasoning model spends its output budget before it emits anything, so a tight `max_tokens`
  returns a well-formed empty answer.** `maxOutputTokens` is declared on `LlmProvider` and **set
  nowhere**: the text path omits `max_tokens` entirely and takes Together's default, and the
  Anthropic path falls back to 4096. Fine today — this is written down for whoever sets one.

  Measured on `openai/gpt-oss-120b`, asked for a single word. At `max_tokens: 8` it returned
  **HTTP 200 with `content: ""`** and `reasoning_tokens: 6`; at 512 it answered `"reachable"`
  having spent **39 of 49** completion tokens reasoning. So roughly 80% of the budget goes to
  reasoning on a trivial prompt, and a limit sized against the *visible* answer starves the
  invisible part that precedes it.

  The failure shape is the point. Not a 400, not a timeout, not a refusal — a **200 with valid
  JSON and nothing in it**, which the extractor reads as "the model found no ingredients" and the
  review screen shows as an empty recipe. Same family as the stale cache serving a confident
  well-formed wrong answer, and as a schema field nobody asks for coming back `[]`: **the
  response is shaped correctly, so nothing downstream has grounds to object.** If a budget ever
  becomes necessary — cost, latency, a provider's ceiling — size it against prompt complexity and
  assert on non-empty content, because an empty string is the one reply that will not look like
  an error anywhere.

- **One run is not a baseline, and the number I quoted for a decision was the low end of a
  five-point spread.** `measure-components` scored **one** reading per recipe while `componentsFor`
  stores the consensus of **three**. Three runs of the *identical* prompt scored `right` **14, 18
  and 19** of thirty. I reported "14/30" as the measured baseline, twice, and built a calibration
  argument on it; the consensus figure is **20/30** and is stable to within a point.

  Two separate faults, and the second is the one that generalises. The spread means **any retune
  claiming less than a five-point move was measuring the weather** — so a plausible wording would
  have "worked" on a coin-flip. And the single reading meant **the measurement path was not the
  shipping path**, the same divergence that let the eval read a card perfectly while production
  sent an Anthropic model id to Together. A measurement harness is code, and the question *does
  this do what production does?* applies to it exactly as it applies to a route.

  So: **report a range or a mean, never a single run, for anything a model produces** — and check
  the harness reproduces the shipping configuration before trusting a single digit of it. The
  tell that something was wrong was available and ignored: the figure sat four points below the
  only other number in the file.

- **A metric blind to the thing being tuned for cannot say whether the tuning worked.** The
  component scorer reported `right` — the *whole* partition correct — and `matched`, which pools
  every kind of component. The report being acted on was *"splitting extracts the protein and
  ignores the sauce"*: a claim about **one kind**. So a retune aimed at sauces was judged by two
  numbers that could not see sauces, and a change that moved sauce recovery would have shown up
  as noise in both.

  Adding `SAUCES RECOVERED` settled the question in one run — and settled it *against* the
  retune, 60–65% before and 55–60% after, which neither `right` (19,20 → 18,20) nor role accuracy
  could have told apart from drift. It also corrected the premise: sauce recovery was **already
  60–65%**, not the near-zero six production recipes implied, so the failure was concentrated in
  one-pan dishes rather than general.

  §54a is *a proxy can rot without failing*. This is the step before it: **ask what the measure
  can see before changing anything, not after.** The question is "if this change worked, which
  number moves?" — and if the answer is "none of the ones I have", the measure is the first piece
  of work, not the tuning.

- **A removal deploys in the reverse order of an addition.** Adding is migration first,
  then code, because code ahead of its schema is a page that 500s — that asymmetry has
  bitten four times and `/api/health` reports `schema` to catch it. Removing inverts it:
  **take away what calls a thing before taking away the thing.** Unschedule the cron, then
  delete the route; stop rendering the column, then drop it.

  Got backwards when the batch importer was retired: the deployment removed
  `/api/import/drain` while the every-minute cron was still scheduled, so production spent
  a few minutes ticking at a 404. Harmless there — a scheduler retrying an idempotent
  drain — and it would not be harmless for anything that counts its failures, alerts on
  them, or gives up permanently after a few. The health check cannot help here either: it
  compares migrations against what the *code* requires, and removed code requires nothing.
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

  **The same mistake wearing a second suit: `echo $?` after a pipe reports the *last*
  command, not the one you care about.** `pnpm check:parity | tail -12; echo "EXIT=$?"`
  printed `EXIT=0` for a run that had exited 1 and printed `DIFFERENCES (database): 2 of
  15 checks disagree` two lines above — the zero was `tail` succeeding. Redirect to a file
  and check the code, or use the pipe status array — and note **this shell is zsh, where it is
  `$pipestatus[1]`, lowercase and 1-indexed**. `${PIPESTATUS[0]}` is the bash spelling and in zsh
  expands to *empty*, so this very workaround silently did nothing the first time it was followed:
  `echo "exit=${PIPESTATUS[0]}"` printed `exit=`. A fix written in the wrong dialect fails the same
  quiet way as the thing it was meant to prevent. One rule, two shapes: **a pipeline can hide the
  result you are measuring, whether by filtering the text or by replacing the status.**
- **A probe owns its fixture or verifies it before reading — because a shared fixture another
  test has already mutated fails *convincingly*.** Two bugs were reported, both plausible. Both
  reproductions used smoke's shared `recipeId`, and the edit test a few hundred lines earlier
  PATCHes that recipe to `ingredients: "2 cups flour"`. So the peanut and the rice noodles were
  gone before either check ran.

  **Both probes measured nothing, and both failed in exactly the shape of the reported bug.** The
  allergen check reported *"still listed — the filter is not wired"* about a recipe with no
  allergen in it. The preference check reported the subject missing from the dropdown because the
  ingredient was no longer on the recipe. One of those bugs was real and one was not, and the
  failing output was indistinguishable.

  That coincidence is what makes this sharper than a check that cannot fail (one entry down).
  A vacuous control is suspicious the moment you read it — it asserts something trivially true.
  **A stale-fixture probe looks like evidence.** It produces the exact failure you went looking
  for, which is the one result nobody re-examines, and it would have had me "fix" a bug that did
  not exist while reporting the real one as confirmed by a test that proved nothing about it.

  So: **a probe owns its fixture, or asserts the fixture's state before trusting the result.** The
  cheap version is a dedicated row — these checks now create their own recipe. The cheaper version
  still is one line: assert the thing you are about to read is actually there. *A probe that could
  not have succeeded has measured nothing* already covers an empty database; this is its sibling,
  where the data exists and is wrong because something else in the suite moved it.

- **A smoke check that calls an endpoint proves the endpoint, and nothing else.** It is
  not evidence a feature exists and must never be allowed to stand in for one. Two of
  the last three things built — caption paste and screenshot upload — had **no way in
  from the product** while their checks were green: the checks called the route, the
  scripts called the route, and a person opening the app could not find either. The
  import screen still offered only "One link" and "A whole folder". "Verified against
  production" was true and meaningless. A feature is reachable from a screen; until it
  is, say plainly that an endpoint exists and the feature does not.

- **A model swap has two sites, and one of them is the one nobody exercises.** The eval
  and the product built their cascades in different places, so wiring the Anthropic
  provider into `eval.mts` — and watching a card read perfectly — verified nothing about
  the app. Production went on sending `claude-haiku-4-5` to Together's Chat Completions
  endpoint and getting nothing back. Same class as an endpoint with no way in from the
  product: the measurement path and the shipping path diverged, and only going through
  the product found it. **Verifying a provider through the eval is not verifying it.**
  Closed by making both call one builder, which is the fix that removes the second site
  rather than watching it.

- **When a guess about a shape is wrong, print the shape.** A heading came back as an
  ingredient from a real card. The first fix compared the line's text to its section
  and missed a `(9x13)` column label appended to it; the second required the line to
  carry no digit, and `9x13` sailed through the guard meant to catch it. Both passed
  their unit tests, because the tests asserted the shape I had imagined. Printing one
  raw payload took a single call and showed `{"text":"Brownie Layer (9x13)","section":null}`
  — which settled in seconds what two guesses had not. Same reasoning as `git log` over
  `git status`: look at the thing itself, not at a summary of it or a model of it. And a
  test that passes while the real input is unchanged is the same class as a test that
  never runs — it is counted.

  **The same failure in a new costume: searching for a shape instead of printing it.** Verifying
  that the Harvest tokens reached the browser, I grepped the served stylesheet for
  `--text:#2B2620` and `--primary:#B4532A` and got **zero**, and reported the tokens as not being
  served. They were. Two mistakes at once, and both were about assuming a shape:

  - **Minified against unminified.** I searched the spelling production emits — no space after the
    colon — against a dev-mode stylesheet that keeps the space. `grep "clip-path:inset(50%)"`
    found nothing for the same reason, minutes after I had already been caught by it once.
  - **The first of several.** I checked `grep -oE '/_next/static/css/[^"]+' | head -1`, and a page
    can load more than one stylesheet. Checking *a* file and reporting on *the* file.

  The fix both times was to grep the **property** and print what came back —
  `grep -oE "clip-path: *[^;}]+"` — rather than grep a guessed value and read absence as fact. A
  value you had to spell correctly to find is a value you can fail to find while it is right
  there, and absence is the one result that looks the same whether you were looking in the right
  place or not.

  **A third costume, and this one is the renderer's spelling rather than mine.** A smoke check for
  `"Step 1 of 2"` failed against a page that says exactly that, because React's SSR separates a
  static string from an interpolated one with an empty HTML comment:
  `Step <!-- -->1<!-- --> of <!-- -->2`. The check failed, the screen was right, and *absence of
  the needle was indistinguishable from absence of the count* — which is how I first read it. Two
  more in the same run: `:root{` found nothing in dev output spelled `:root {`, and a probe written
  to print the shape created no recipe and printed an empty string, so it measured nothing while
  looking like an answer.

  So the rule now has a mechanism rather than a resolution. **Every human-text assertion in smoke
  goes through `visible()`**, which strips comments and entities, because the next interpolated
  marker will make the same mistake and nothing else would catch it. And when a grep returns
  nothing, the next move is to grep the *property* and print the value, or enumerate what spellings
  actually exist in the file — never to report the absence.

  **Reach for the print before the grep, not after.** Three more unearned answers in a single
  round, each caught only by printing: `--include=*.tsx` glob-expanded in zsh so the grep never
  ran and "0 files" was nothing at all; `.h-docked` prefix-matched `.h-docked-page` and reported
  the wrong rule's body; and selector-exact matching found no `.h-tabbar{` in production because
  **the minifier had merged it into `.h-docked,.h-tabbar{`**. A fourth, smaller: `color:` inside
  `border-color:` made my own probe report a violation that was not there — the same regex flaw I
  had just fixed in a guard, repeated in the probe checking it.

  Every one was a guess about a *spelling* — of a glob, a selector boundary, a minifier's output,
  a property name — and in every case the absence looked identical to a finding. So the habit is
  the inverse of the instinct: **print the thing, then search what came back.** `grep -o` the
  property and read its value; list the selectors that actually exist before matching one; quote
  the glob. The grep is for confirming a shape you have already seen, not for discovering one.

- **A schema field is not a request, and a field nobody scores stays empty forever.**
  `steps` was in the extraction schema with a description, and `EXTRACTION_INSTRUCTIONS`
  was eight sentences every one of which was about ingredients. Every caption came back
  with `"steps":[]` — including one with a `DIRECTIONS:` heading and a numbered list. The
  model was doing exactly what it was told. The eval could not see it because the fixtures
  score ingredient fields, so the field was never asked for *and* never measured, which is
  **"silence reads as success" one level up**: not a check that could not distinguish no
  result from a pass, but a capability nothing ever exercised. Ask for every field the
  schema declares, and score every field you ask for — an unscored field is an unrun test.

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
*Health data was the fourth item here and is **settled**: allergens are stored on the household,
not the member (§71). "This household avoids peanuts" identifies nobody and is the same category
as being vegetarian, so the special-category question dissolves rather than being managed. The
rule it leaves behind is worth keeping, though — **if the more sensitive shape produces an
identical answer, it is not a design choice, it is a liability.** Per-member allergens would have
held health data to compute a household-wide exclusion, because you do not cook two dinners.*

If a task requires one of these to be settled, stop and say so rather than
guessing.

- **`git push` deploys; `db:push` is remembered by a person, and that asymmetry has now
  shipped code ahead of its schema four times.** The recipe list, browse, the photo upload
  path and `/household` each reached production querying a column the database did not
  have, and each surfaced as a **server-side exception on a page** — not as a failed
  build, not as a failed test, not as anything a deploy noticed. A rule that has failed
  four times against people who know it is not a rule; it is a missing mechanism.
  `/api/health` now reports `schema`, comparing `REQUIRED_MIGRATION` against what the
  database has applied, and **names the missing migration and the command that fixes it**
  so the answer is one curl rather than a diagnosis. It reports `unknown` when it cannot
  check, never `ok` — a check that cannot run must not look like one that passed.

  **Then it happened a fifth time, and `schema` said `ok` throughout.** Two migrations landed, the
  seam's select list grew a column hosted did not have, every provisioning request 500'd, and
  `pnpm smoke` reported `2 of 36 FAILED`. The mechanism built for exactly this was green because
  **the stamp is hand-turned and nobody turned it** — *a version stamp only works if somebody
  turns it*, arriving through the one place that was supposed to be immune to it.

  Worse, `schema-version.ts` argued against deriving the constant: *"computing it from the
  migrations directory would make it always correct and therefore never informative."* **That
  reasoning is wrong.** The constant describes the *build*; the comparison is against the
  *database*. Deriving it makes it always correct about the build and leaves the interesting
  question — has the database caught up — exactly as open. What the argument really protected
  against was a migration no code depends on raising a warning: a **false alarm where the
  alternative is a false ok**, and one costs a `db:push` while the other costs production.

  So `scripts/check-schema-version.mjs` asserts the stamp names the newest migration, and
  `pnpm check` now fails when it is stale. It stays a literal rather than a runtime directory
  read, because a serverless bundle reading `packages/db` at request time is the file-tracing
  hazard this project has already paid for. **A guard, not a reminder** — which is what a rule
  that has now failed five times against people who know it actually needs.

  **Sixth instance, and the guard worked and did not prevent it.** Code whose seam select included
  `kroger_location_id` shipped before the migration reached hosted — but the stamp was correct this
  time, so `/api/health` said `MISSING 20261011090000_kroger_export` with the fixing command
  instead of a false `ok`. A diagnosis in one curl rather than an afternoon, and still an outage.

  **Prevention turns out to be cheap**, which is worth knowing because the diagnosis had been
  treated as the ceiling. `applied_migration_versions` is readable with the **service role** the
  project already holds — no management token — so diffing local filenames against hosted takes a
  second. Verified it would have fired: at that commit, local had the migration and hosted did not.

  `scripts/check-migrations-pushed.mjs` does it, and **deliberately not inside `pnpm check`.**
  During normal work the migration exists locally first — schema, then code, then push both — so a
  check refusing any local-but-not-hosted migration would fail on every machine mid-feature, and a
  check that fails routinely is one people learn to ignore. That is worse than no check.

  So it is a *pre-push* question, and `pnpm ship` runs it and then pushes — **which removes the
  ordering decision rather than policing it.** That is the actual fix: the asymmetry was that one
  half deploys itself and the other is remembered, so the answer is one command that does both in
  order. The health check stays the backstop for a push that comes from somewhere else.

  **`pnpm ship` also runs `next build` before pushing** — see the `tsc` entry below for why
  `pnpm check` cannot stand in for that.

- **Verifying that A works and that B works is not verifying that A hands off to B.** Asked
  whether future weeks could be planned, I checked two things: the planner navigates weeks
  (it does) and the shortlist is week-scoped (it is). Both true, and I reported the feature
  working. It was not. "Make this week" hard-coded today's Monday at both call sites, so a
  recipe shortlisted from anywhere landed in *this* week while the planner's waiting list
  filtered to the week being viewed — **each half correct, the join broken, and no order of
  operations that worked.** The same session I even noticed the hard-coded line and filed it
  as a small separate bug rather than as the whole of the reported problem.
  So: when somebody reports that a journey does not work, **trace the journey**, in order,
  across whatever boundary it crosses — a week, a household, a deploy — rather than
  auditing its components. A component test cannot see a handoff, and a handoff is where
  two people's correct work meets. Same family as *an endpoint answering is not a feature*
  and *a permission nothing has exercised is a permission you do not have*: all three are
  the gap between a part being right and the path through it being walked.

  **The rule, so this is a habit rather than a diagnosis:** a value that crosses **three or
  more boundaries gets one test that walks the whole path**, in order, asserting the value at
  the far end. Not a test per hop — those already exist, and they are what make the join
  invisible. Component tests cover the hops and **cannot see the join by construction**, so
  no number of them adds up to one walk.

  Four bugs have now lived in a join and none in a hop: the future-weeks handoff above; the
  classification query; the eval cascade diverging from the product's; and `section`, which
  crossed parser → `draftFrom` → `prepareRecipe` → insert with every hop correct, every test
  green, and nothing on the screen. That last one is the worst shape of it — **a passing suite
  arguing a feature exists is worse than an endpoint that says nothing**, because the endpoint
  at least never claimed otherwise.

  Count the boundaries when adding a value, not when a bug is reported. Three is the trigger:
  `apps/web/test/section-round-trip.test.ts` is the template.

- **A threshold is only meaningful inside the range the data actually occupies.** Measured across
  every household: **0 of 46 ratings in the real one are a 1 or a 2** — the scores are 11 threes, 16
  fours, 19 fives, and the only sub-3 anywhere is a single 2 written during a demo household's setup
  session. So `AVOIDS = 2.5` is not improbable, it is **arithmetically out of range** of any mean of
  a 3–5 distribution, and `warningsFor` produced **0 warnings** when run against the real data.

  But the *binding* gate was one nobody predicted: `ENOUGH_TO_SAY = 6` ratings within a single
  dimension, against **0 patterns and 32 readings all `too-few`** — 46 ratings over 10 recipes × 3
  dimensions × 5 members fragments into buckets of one. **A count threshold is the same question
  asked about volume instead of value**, and it fails first.

  The converse matters as much: a threshold *inside* the range works fine. `>= 4` excludes 5 of 10
  recipes, a clean half. So the lesson is not "thresholds are suspect" — it is that **4 discriminates
  on a 3–5 scale and 2.5 cannot**, and only counting the values tells you which you have written.

  §82 is this from the other side: there a **label** interpreted a value nobody gives, here a
  **threshold** compares one. Both come from a spec written against what the column permits rather
  than what the rows contain. **Count the values before writing a label about them or a threshold
  against them** — one query answers both (decisions §82, §83).

- **`tsc` cannot know Next's page contract, so a green `pnpm check` is not evidence that it
  builds.** `export { SLOTS }` from `app/today/page.tsx` — a leftover re-export nothing imported —
  is **valid TypeScript**. It compiled, passed `tsc`, passed all 215 tests, passed every boundary
  guard, and failed only at `next build`: *"SLOTS is not a valid Page export field"*. A page file
  may export `default`, `metadata`, `generateMetadata`, `revalidate`, `dynamic` and a short list
  of others, and that list lives in Next's build, not in the type system.

  **Worth naming because the next person will reasonably assume a green check means it builds.**
  It does not, and the gap is not a gap in thoroughness — `pnpm check` is boundaries, typecheck
  and tests, and none of those three has any way to learn a framework's file conventions. The
  whole class is invisible to it: a bad page export, a `"use client"` file exporting an async
  server function, metadata of the wrong shape. The only gate that knows is the one that runs on
  **Vercel, after the push**.

  So `pnpm ship` runs `pnpm --filter @pashki/web build` before `git push`. Same placement and same
  reasoning as `check-migrations-pushed`: a build on every mid-feature `check` is slow enough to
  get skipped, and immediately before a push is the moment the answer matters. **A guard, not a
  reminder**, in the one place that removes the decision.

  How it surfaced is the part worth keeping. `check-shipped` printed `AHEAD OF DEPLOYED BY 1
  COMMIT` five minutes after a push that normally lands in sixty seconds. Before that it looked
  like **six smoke failures against production**, which were the new suite running against the
  *old* deployment — this project's own *name-the-host* lesson arriving as a false bug **report**
  rather than a false pass, and the more confusing direction of the two. Without that guard the
  session would have ended on the word "shipped".

- **A check can report on something adjacent to what it claims, and the claim is what gets
  believed.** `alive()` in smoke accepts any status under 500, because it answers *did a handler
  run* — and a screen check used it, so a route that did not exist printed
  `ok /today renders — HTTP 404` with **every marker beneath it failing**. A screen check requires
  200 now; a 3xx is not a rendered page either, since the list is screens a signed-in person can
  reach.

  This shape has now arrived enough times to be worth enumerating rather than counted by feel, so
  the number is checkable the way a figure on screen has to be:

  1. the mutation harness treating **zero matched tests** as a pass — it reported on the tests it
     ran, and it ran none
  2. **smoke calling routes** — it reported on the endpoint and was read as the page, which 500'd
  3. the **eval's cascade** — it reported on a provider and was read as production's, which was
     sending an Anthropic model id to Together
  4. **`promptKey`** — it fingerprinted every input the recipe carries and was read as
     fingerprinting the prompt, which it omitted
  5. **`check-busy-guarded`** — it reported the pending flag and was read as covering the offline
     rejection, whose other half left nine screens silent (§80)
  6. **`check-contrast`'s pair table** — it reported a pairing and was read as reporting the rule,
     while the CSS used a different token
  7. **`alive()`** — it reported that a handler ran and was read as a page rendering

  Seven by that list, where the brief for this one said six; the discrepancy is probably whether
  §54a's rotted proxy counts, and the list is here so a reader can take their own view instead of
  inheriting mine. **What is new in the seventh is that the contradiction was visible in the same
  output** — `ok` on one line, four `FAIL`s directly beneath it, `HTTP 404` printed in its own
  detail. Every earlier instance needed a second measurement to expose; this one needed somebody
  to read two adjacent lines together, which is a weaker excuse and a better reason to fix the
  helper rather than the habit.

- **A long-press gesture competes with the platform's own long-press, and the page does not
  arbitrate.** Drag-a-meal-to-another-day was attempted and withdrawn (decisions §81) after failing
  twice on the device it was for — the second time selecting text on a handle carrying
  `touch-action: none`, `-webkit-touch-callout: none` and `user-select: none`, **all four verified
  served on the right node** in the production stylesheet and HTML. Those are the documented
  defences and they are advisory in an in-app Safari. Treat this as a case for native, not as a
  thing to attempt a third time; a gesture that fails on the device somebody actually uses is worse
  than no gesture, because it is a control that appears to exist.

  The transferable half is not about touch. **When a control's target is also the only label for
  that target, the control cannot report its own outcome.** The handle was the date block, and the
  date block is the only thing on a row saying which day it is — so the thumb covered the answer to
  the one question the gesture had to settle before release. That is a design constraint on any
  platform, and the fix is a readout placed where the hand is not, naming the target in words.

- **There is a renderer now: `pnpm shots`. Some faults are only visible in a picture.**
  `scripts/shot.mjs` renders every screen at **390px** in both themes with Playwright, writes a PNG
  each, and asserts the two things only a layout engine knows: **no horizontal overflow** (naming
  the culprit element) and **no text box too narrow for a word**.

  The fault that bought it: the rotation's tiles were the Harvest list card — `96px 1fr` built for
  a 350px full-width row — dropped into a two-column grid. In a 169px column the title got 17px and
  the browser gave it **0px wide by 329px tall**, one character per line, on every tile of two
  layouts. **Every guard passed**: 121 contrast pairs, every class styled, every role right, 250
  tests, and smoke's markers were all present *because the text was there*. For twenty turns the
  honest line was "no pixels, that part is yours"; it should have been "install a browser".

  Three lessons the tool itself taught, in order:

  1. Its first run reported **ok on all eight screens** — of a page reading "this account has no
     household yet", because it never provisioned one. *A probe that could not have succeeded.*
     It now provisions, asserts the household and the recipe count, and each screen asserts it
     rendered its own content; all three are exit 2.
  2. Its heuristic then **skipped the exact fault** it was written for: `if (box.width === 0)
     continue`, meant to ignore unrendered elements, filtered out the 0px-wide titles. Zero width
     *is* the signature. §80 inside the tool built to catch what guards cannot see.
  3. Asserting *proximity* failed against correct markup — `aria-checked="true"` within 400
     characters of its label, when the preview diagram puts the real distance at **620**. Assert by
     **order**, not by a window: a window is a guess about a spelling.

  So: **render before claiming a layout works**, and when a screenshot and a stylesheet disagree,
  the screenshot is the one that has looked.

- **`flex: 1` does not mean a flex child can shrink: `min-width` defaults to `auto`, which floors
  it at min-content.** So a `flex: 1` cell holding one unbreakable ingredient name — or a button
  with `white-space: nowrap` — widens its row past the viewport, the *page* becomes wider than the
  screen, and because the mobile layout viewport grows to the content, every `position: fixed`
  element sizes to a width that is not the screen. The docked bars go wrong as a consequence of a
  cell nobody was looking at. **`min-width: 0` is the opt-out and it is needed on every flex child
  that holds text.**

  It was live on thirteen screens, and the measured case was the score grid: **270px available**
  inside a day row on a 390px phone — the viewport less the week's 20px gutters, the row's 12px
  padding and the 44px date block with its gap — against **340px needed** for a 5rem name column
  plus five 44px buttons. 70px over, the last column cut off on every row.

  **And a grid item has the same default.** §85 hit it again: `section.h-layout` is an item of a
  `display: grid` parent, so its `min-width: auto` floored it at min-content — the shelf's nine
  118px tiles stretched the item to 548px, the `overflow-x: auto` scroll container therefore
  inherited 508px instead of 350px, **never became narrower than its content, and never scrolled**.
  The page was 564px wide instead. The rule is every item of a grid or flex container that must not
  grow, not only the ones holding words.

  **The ratio is the useful part.** Grepping for the naive cause — a non-wrapping `display: flex`
  — returned **38 rules and almost all were noise**, because a non-wrapping flex row only overflows
  if its children *cannot shrink*. Narrowing to "no child rule carries `min-width: 0`" cut it to
  10, of which about half were genuine. So the lesson is about the shape of the search rather than
  the fix: **the obvious grep for a layout bug is nearly all false positives, and the real pattern
  is narrower than the symptom suggests.** A guard written off the naive pattern would have failed
  on 38 rules from the first run and been switched off the same day — the `check-migrations-pushed`
  argument arriving in CSS.

  No guard exists for this, deliberately and with a reason rather than from neglect: which
  foreground actually overflows which container is a layout question, and layout needs a browser.
  There is none here — `jsdom` has no layout engine — so the honest position is that the *causes*
  are fixed and audited, and only a device confirms the result. The real fixes are
  `min-width: 0`, `flex-wrap` on strips holding a variable number of controls, and
  `overflow-wrap: break-word` on the body. **Never `overflow-x: hidden`**, which makes the symptom
  invisible while the layout viewport stays too wide — fixing the thing you can see and keeping the
  thing that breaks the bars.

- **The instrument was wrong, not weak — three times now, and the next one will be a fourth
  instrument rather than a repeat of any.** This is the family entry; the instances keep their
  detail where they are.

  | the check | was green and correct about | could not see |
  |---|---|---|
  | `check-contrast` (§79) | *can this be read* | **whether it is the palette.** Near-black behind white text scores ~13:1 — perfectly legible, and `tokens.ts` contains no black. Answered by `check-palette-roles`: a *role* question, not a contrast one. |
  | `check-contrast` again (§84) | *can this be read* | **whether two fills are distinguishable.** Two dark chip tints differ by 1.13:1 and read alarming; luminance ratio is the wrong axis for "are these different". ΔE 16.6 by CIE76 — *more* separable than the light pair at 11. No new guard: the fix was to stop asking contrast a perceptual question. |
  | `check-busy-guarded` (§80) | *is the pending flag cleared* | **whether anything was said.** One `fetch` rejection has two consequences and the guard was built for one, so 9 of 29 try-blocks passed a check written about the exact failure they exhibited. Answered by `check-offline-said`. |

  **In all three the check was green and right.** Not stale (§54a — those keep answering a question
  that has changed), not unused (`EXTRACTOR_VERSION` and friends — those were never turned), and not
  adjacent-by-accident (the seven-item list below — those reported on a neighbour of their claim).
  These three were **pointed at the wrong axis of the thing they were measuring**, and a correct
  answer on the wrong axis is the hardest kind to doubt, because there is nothing wrong with it.

  So the question to ask of a measurement is not *is this passing* or even *is this still measuring
  what it measured* — it is **what axis is this instrument sensitive to, and is that the axis the
  question is about?** Contrast is luminance. A guard is its assertion. Both are exactly as
  described and neither is the question you brought. Expect the fourth to be a new instrument
  answering correctly about something nobody asked.

- **One failure, two consequences, and a guard built for one of them reads as coverage for both.**
  An offline `fetch` **rejects**, and that one fact kills the pending flag *and* leaves the screen
  silent. `check-busy-guarded` was built from a real incident for the first, is mutation-tested,
  and a `try`/`finally` with **no `catch`** satisfies it completely — so **9 of 29** client
  try-blocks passed a guard written about the exact failure they were exhibiting. Sign-in gave a
  person with no signal no explanation; the recipe form discarded a typed recipe in silence. The
  second consequence is the worse one: a dead screen is *visibly* wrong, a silently dropped write
  looks like it worked (decisions §80, `check-offline-said.mjs`).

  Not *a mechanism right and unused* — this one was used, green on every build. Not a stale proxy
  either; it still measures what it always measured. **A guard's existence gets read as coverage
  of its subject when it is only coverage of its assertion**, and nobody re-reads a passing check
  to ask what it does not say. So the question belongs beside *which files does nothing check?*
  and *how many caches does this invalidate?* — **which consequences of this failure does my
  assertion not cover?** Asked of all twenty guards once: three looked real, all three clean
  today, recorded as clean because an audit that finds nothing by running is a different fact from
  one that finds nothing by not running.

- **"Confirmed served" must name the host, or it has confirmed nothing in particular.** Five
  screens were reported green with smoke at 175 of 175 while production served the *previous*
  palette — zero `.h-` rules, zero Harvest tokens, no Fraunces, still `--ink` and `--paper`. Both
  statements were true and one of them was never about the deployment: **every** check ran against
  `127.0.0.1:3000`. `pnpm smoke:local` is `smoke.mjs http://127.0.0.1:3000`, and `pnpm check` and
  every guard read local *files*.

  The phrase is what did the damage. "Confirmed served", "verified in a browser", "as served" —
  each **concealed** the gap rather than omitting it, because they sound like claims about a
  deployment and are claims about a laptop. A host-less verification reads as stronger than it is,
  which an honest "I could not check" never does. So: **name the host in the sentence**, every
  time, or do not use the word verified.

  **Third instance of a mechanism that was right and unused — and the first where the mechanism
  was built in the same session it then went unused.** `EXTRACTOR_VERSION` sat unturned through
  two releases; `promptKey` fingerprinted every input except the prompt; and `pnpm ship` exists
  precisely for "one half deploys itself and the other is remembered", was built earlier in this
  very session, and was used **zero times across ten commits**. That is a worse shape than the
  first two: a tool whose own commit message argues for it, ignored by its author within the hour.
  A mechanism you just built is one you are *most* likely to skip, because the reasoning feels
  discharged by having written it.

  `pnpm ship` stays outside `pnpm check` — a check that refuses every mid-feature tree would fail
  routinely, and that argument is still right. What it left behind was that **nothing asked the
  question at all.** So `scripts/check-shipped.mjs` asks it, and is the one guard here that
  **never fails**: it prints `AHEAD OF DEPLOYED BY N COMMITS` and the undeployed subjects, out of
  `/api/health`'s own mouth, and exits 0 always. It runs at the end of `pnpm check`, inside the
  success branch, so the line lands directly under the words "check passed" — the point being that
  "green" and "ahead by 10" are impossible to read together and call it done. It would have fired
  at all ten commits, and prints `DEPLOYMENT UNKNOWN` rather than silence when it cannot reach the
  site, because the failure it exists for *was* a silence that looked like a pass.

- **A reference screen is evidence of what the app looked like, not of what it should offer.**
  Five findings across four screens, written up as **decisions §78** with the discriminator table.
  A mockup and an implementation disagree in exactly three ways and they want opposite responses:
  a **styling choice** (the reference omits a live feature — keep it); **the app lying** (the
  reference faithfully reproduces something already broken, like the dead `lunch` chip or a timer
  row for a duration no column holds — check the schema before building the control); and
  **deliberately elsewhere** (the app answers that question in another place on purpose — the
  second shopping list, leftovers, shared ingredients).

  The third is the one a redesign gets wrong, because **from outside it is identical to the
  first** — the reference shows something at a position and the screen does not have it there, and
  the instinct is *they missed this, add it*. Acting on it produces a **duplicate**, not a fix:
  two implementations of one question, which then drift. And the reason is **not in the screen** —
  a relocation leaves no trace where it moved *from*, so it lives in a decision record, which is
  not what anybody reads while restyling a component. Hence the habit that actually works: **put
  the reason in the component**, and before adding anything the reference shows, search for the
  *question it answers* elsewhere in the app rather than for the control.

- **A guard can be wrong by being too broad, and that failure points the other way.** Masking the
  chapter icons needs `background-color: var(--text)` — the exact pattern `check-palette-roles`
  forbids ("text: ink, never a background"), because under a mask that fill *is* the ink. Two
  guards fired on correct code: that one, and `check-theme-complete` demanding dark definitions for
  `--chapter-icon`, which holds a `url()`. Not a false ok — a **false alarm**, and the costly
  response would have been a blanket allow. Both were narrowed instead: the fill is exempt only in
  a rule that *itself declares a mask*, and the theme check takes a **named list of two** instance
  properties rather than the obvious pattern — "exclude anything the token sheet does not define"
  would have gutted it, since a misspelled `var(--txet)` is precisely such a property. Then
  re-mutated, because an exemption nobody re-tested is an exemption nobody has measured. **Name the
  narrowest condition that separates the legitimate case, never the category it belongs to.**

- **A fixture that fails silently produces a screenshot of the wrong thing — and a screenshot is
  the one artefact nobody re-reads.** `shot.mjs` classified its recipes with `PATCH { course }`
  into an endpoint whose `prepareRecipe` requires a title. Every call returned 400 "a title is
  required", `.catch(() => {})` swallowed it, and **no shot had ever had a course on any recipe**:
  browse rendered one "Not sorted yet" chapter of nine and looked entirely plausible in both
  themes, for as long as the tool has existed. *A probe that could not have succeeded has measured
  nothing* usually leaves an empty result somebody notices; this left a beautiful picture. So a
  fixture **checks the write it depends on and exits 2 when it does not stick** — the renderer now
  refuses to shoot unless all of them classify. And the lesson is narrower than "check responses":
  the screenshot tool was built to catch what guards cannot see, and it had a blind spot of exactly
  the same kind inside it.

- **`width` and `height` do nothing to a `<span>`, and a flex parent hides it.** The masked chapter
  icon rendered correctly inside `.h-chapter-tile` — a flex container, which blockifies its children
  — and **was simply absent** from the chapter page's hero, an ordinary centred block where the span
  stayed inline and collapsed to zero. Every guard passed: the class is styled, the element is in
  the DOM, the mask is right, the contrast pair is gated. `display: inline-block` is the fix, and
  the habit is to set it on anything sized rather than rely on the one parent that was tested.

- **A column's fill rate is a property of the subset, not of the table.** §85 refused the fridge
  layout because `principal_protein` is named on **25 of 67** recipes, and that measurement was
  correct. Inside Mains the same column is named on **22 of 32** — Mains is where the classifier
  succeeds — so the protein axis that fails library-wide works as a subdivision. The refusal stands
  and was never the whole story: **re-measure a rejected axis inside each candidate subset before
  concluding it is dead**, because "37% of the library" and "69% of the chapter" are the same column
  answering two different questions.

- **An assertion that only holds for a fixture it does not create is measuring the fixture.** A
  smoke check asserting "Mains divides into chapters" failed against entirely correct behaviour —
  that household has two mains, and dividing two recipes would be the bug. Rewritten to assert the
  *rule* in both directions (over seven divides, seven or fewer lists), it holds on any library.
  The honest half: only one branch of it runs in smoke, so the comment says where the other is
  covered (`pnpm shots`, nine mains, both themes). **Two probes, one rule, and neither pretending
  to be both.**
