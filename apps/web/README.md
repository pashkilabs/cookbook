# @pashki/web

The web app. A list you can search and filter, a recipe you can read, and a form you can type
one into.

| | |
|---|---|
| `/recipes` | the household's recipes, with search and the three filters — make-again, untried, whole-family-likes |
| `/recipes/new` | type one in |
| `/recipes/[id]` | ingredients through `@pashki/core`, the method, the photo, per-member ratings |
| `/recipes/[id]/edit` | change it |
| `/planner` | a week, seven days, and whatever is shortlisted waiting for one |

**Ingredient lines go through core's parser, not a form with separate amount/unit/item
fields.** That is deliberate: it is the same path an import will take, so every recipe typed by
hand exercises the parser against real typing before a model is involved. The preview under the
textarea is the same parse the server will do — run in the browser, because `packages/core` is
pure and bundles anywhere — so somebody can see that `1 (14 oz) can chopped tomatoes` was
understood before saving.

**Filters live in the URL** as a plain GET form with no client component, so a filtered list is
a link somebody can send to the other adult in the household. `whole-family-likes` is computed
in app code rather than in the query: "everybody who rated gave 4 or 5" is a condition over a
group of rows, and expressing it through PostgREST needs a view or an RPC — a schema change it
has not earned. An unrated recipe is not liked by the whole family; it is unknown, which is what
`untried` is for.

**Editing replaces the child rows rather than diffing them.** Position is the only identity an
ingredient line has, so "line 3 changed" and "a line was inserted above it" are
indistinguishable from the text alone. The old rows are tombstoned, which is also what a syncing
peer needs.

## The planner

`meal_plans`, `plan_entries` and `shortlist_entries` had never been rendered. The flow is
browse → shortlist → schedule, and the shortlist is what separates the two: a recipe can be
wanted this week without yet having a day.

**Week arithmetic is UTC, in `lib/week.ts`, and unit-tested.** `week_start` and `date` are
Postgres `date` columns — a calendar day with no zone. Local `Date` maths would mean a household
in Auckland planning Monday and the server storing Sunday, a bug that appears for some people at
some times of year. Anchoring at UTC midnight and never formatting through a locale removes the
class, daylight saving included. Writing the tests found a real one: `Date.UTC(2026, 1, 30)` does
not fail, it rolls into March, so `?week=2026-02-30` would have silently opened a different week
— `isIsoDate` now validates by round-tripping.

**The week's `meal_plans` row is created on demand**, by the first placement, so a household that
never opens the planner accumulates no empty weeks. Find-then-insert rather than upsert, because
the unique index is partial (`where deleted_at is null`) and PostgREST cannot name one as an
`ON CONFLICT` target; a lost race returns `23505`, which is read back rather than reported.

**`week_start` is derived from the day being planned**, never taken from the caller alongside it.
Nothing in the schema ties an entry's date to its plan's week — the composite key ties it to the
*household* — so two sources could disagree.

**Placing a recipe takes it off the shortlist**, because it is no longer waiting for a day. Both
shortlist verbs are idempotent: the button behind them can be pressed twice on a slow connection,
and the caller asked for a state rather than an event.

Scales are 1×, 1.5× and 2× — the prototype's, and a free numeric field invites 0.3333.

**Removal is a tombstone too.** Clients hold no `DELETE` privilege (091300) because a
hard-deleted row cannot be told from one that never synced. Confirmation is inline, never
`confirm()` — a native dialog is poor on mobile and an embedding context can suppress it, which
would turn "are you sure" into "deleted".

```bash
cp .env.local.example .env.local   # then fill it in — see below
pnpm --filter @pashki/web dev      # http://localhost:3000
```

## Environment

`.env.local` is gitignored and the only place credentials live. Nothing here reads a
committed value.

| | |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | project URL; safe in the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key; safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only.** Never `NEXT_PUBLIC_` — a service-role key in a bundle is every household's data |
| `PASHKI_TOKEN_KEY_ID`, `PASHKI_TOKEN_PRIVATE_KEY` | the entitlement signing key (decisions §15) |
| `NEXT_PUBLIC_SITE_URL` | where this app is reachable. **Confirmation links are built from this, not from the request's `Host` header** — a Host is attacker-controlled, and letting it choose the link in an email is how confirmation links get poisoned. It must also be in the project's redirect allow list, path glob included, or GoTrue silently substitutes `site_url` |

`scripts/check-server-only.mjs` fails the build if a `"use client"` file imports the seam
or reads one of those server-only names.

## How it is wired

**Reads go through the person's own session.** `lib/supabase-server.ts` builds a client
from the session cookie, so `recipes` is read as `authenticated` and row-level security
decides which rows come back. Reading with the service role and filtering in application
code would have worked until the day somebody forgot the filter.

**Both screens filter by `family_id`, which is not redundant.** Published recipes are
world-readable (decisions §17), so RLS legitimately returns other households' public recipes.
Isolation and presentation are different questions — without the filter, the list showed a
stranger's roast chicken, which the first render of it duly did. On the detail screen the same
filter is what makes an id belonging to somebody else `notFound()`: a stranger's *published*
recipe 404s on a URL guess rather than rendering, and an id that does not exist 404s
identically, so neither answer confirms the recipe is real.

**A rating is update-then-insert, not an upsert.** `ratings_one_per_member` is a partial unique
index (`where deleted_at is null`) and PostgREST cannot name one as an `ON CONFLICT` target —
it has no way to restate the predicate. Two devices rating the same person in the same instant
can therefore both insert; the index refuses the second, which surfaces as a message rather
than a duplicate.

**The photo is a signed URL, signed as the viewer.** The bucket is private, so the storage
policy — which resolves through the `photos` row — is what authorises it, the same reasoning as
reading the rows. Verified end to end: the page renders a signed URL, it serves the image, and
an unauthenticated caller is refused the same object.

**The household id comes from the seam.** `family_members` is a platform table and
`check-platform-tables.mjs` fails the build on a direct read, so the page asks
`platformStore().findFamilyForAccount()` server-side.

**`/api/platform/*` mounts the existing router.** `createPlatformRouter` already decides
the routes, the status codes, and that the account is resolved from the bearer token and
from no parameter anywhere. `toFetchHandler` adapts it to Next. Phase 3's Expo app calls
the same routes, which is why the router was framework-agnostic before anything used it.

**Sign-up sends an email and creates nothing else.** `POST /api/signup` asks GoTrue for an
unconfirmed user and returns. No `accounts` row, no household, no membership — those wait for
the address to be proven. See *Confirming an address* below.

**Provisioning happens at first confirmed sign-in**, in `lib/provisioning.ts`, gated on
`email_confirmed_at`. It is idempotent, so `/api/household` can be called on every sign-in and
only the first does work. Decisions §27.

## Confirming an address

Sign-up sends a link; the account cannot be used until it is followed. GoTrue refuses to mint
a session for an unconfirmed account, so "cannot sign in" is enforced upstream of us, and
`lib/provisioning.ts` refuses to create a household without `email_confirmed_at` even when
handed a valid session.

**The session arrives in the URL fragment**, because Supabase's default confirmation email
links to GoTrue's own `/verify`, which confirms the address and redirects back with
`#access_token=…&refresh_token=…`. A fragment is never sent to a server, so no route handler
can read it — `app/sign-in/confirmation.tsx` completes it in the browser and then calls
`/api/household`.

The tidier server-side alternative (`verifyOtp` with a `token_hash`) needs a custom email
template, and hosted refuses one: *"Email template modification is not available for free tier
projects using the default email provider."* Running one flow locally and a different one on
hosted is the asymmetry that has already produced two bugs here, so both use the default.

**Reading the mail locally:** Mailpit, at http://127.0.0.1:54324. Its API is useful in
scripts — `GET /api/v1/messages`, `GET /api/v1/message/{id}`, `DELETE /api/v1/messages` — and
note the HTML escapes `&` as `&amp;`, so a link scraped from it needs unescaping before it
will resolve.

**What hosted does**, checked rather than assumed: `mailer_autoconfirm: false` (it already
wanted confirmation — our old `email_confirm: true` was overriding it), no custom SMTP, and
`rate_limit_email_sent: 2` **per hour, project-wide**. That last one is the blocker for public
signup: two confirmation emails an hour across all users is a test allowance, not a service.
**Custom SMTP must be configured before signup is opened.**

## Known gaps, deliberately

**Address enumeration is closed at our surface, not at Supabase's.** `/api/signup` and
`/api/resend` answer identically for a registered address, a new one, and a rate-limited one.
But the anon key is public, so Supabase's own `/auth/v1/signup` is reachable directly and
returns `identities: []` for an address that already exists. Closing that is a project
setting, not our code, and it belongs on the list for opening public signup.

**The resend limiter is in memory, so it is per process.** Two instances each allow the full
budget and a restart forgets. It is a courtesy against impatient clicking; the real ceiling is
Supabase's own per-hour limit, enforced where we cannot lose track of it. A shared limiter
needs a store, and that is worth doing at the same time as custom SMTP.

**Nothing rate-limits by IP.** Both endpoints are keyed by address, so one client can probe
many addresses at whatever rate Supabase allows. A CAPTCHA or an IP limiter belongs with
opening signup.

**A new household has no entitlement, so it can read and not write** — decisions §9 working
as intended, since absence is not an unmetered allowance. Real issuance is a billing webhook
blocked on Apple's outside-purchase rules.

For local work, `PASHKI_DEV_ISSUE_ENTITLEMENT=true` makes sign-up issue one so a created
household can actually write. **It is not a trial and not a free tier** — both are open
questions in `docs/decisions.md`, and the numbers in `lib/dev-entitlement.ts` are
development values rather than policy. It is off unless set to exactly `"true"`, it logs a
warning every time it fires, and it is named for what it is so that finding it set in a
deployed environment reads as a mistake. It is deliberately not also gated on `NODE_ENV`:
`next start` serves a production build, so that check cannot tell a laptop from a
deployment and would only break the workflow the flag exists for. When there is a real
deployment, gate it on that platform's own environment marker.

**No design system.** `packages/ui` does not exist; `app/globals.css` is plain enough to
read and not worth keeping. Building one inside one screen is how it ends up living here.

**No middleware refresh.** A session is read where it is found; it is not refreshed on
navigation. Fine for a single screen, wrong for a real app — that is `middleware.ts` and it
arrives with the second screen.
