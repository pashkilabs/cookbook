# @pashki/web

The web app. One screen so far: the recipe list.

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

`scripts/check-server-only.mjs` fails the build if a `"use client"` file imports the seam
or reads one of those server-only names.

## How it is wired

**Reads go through the person's own session.** `lib/supabase-server.ts` builds a client
from the session cookie, so `recipes` is read as `authenticated` and row-level security
decides which rows come back. Reading with the service role and filtering in application
code would have worked until the day somebody forgot the filter.

**The list also filters by `family_id`, which is not redundant.** Published recipes are
world-readable (decisions §17), so RLS legitimately returns other households' public
recipes. Isolation and presentation are different questions — without the filter, this
screen showed a stranger's roast chicken, which the first render of it duly did.

**The household id comes from the seam.** `family_members` is a platform table and
`check-platform-tables.mjs` fails the build on a direct read, so the page asks
`platformStore().findFamilyForAccount()` server-side.

**`/api/platform/*` mounts the existing router.** `createPlatformRouter` already decides
the routes, the status codes, and that the account is resolved from the bearer token and
from no parameter anywhere. `toFetchHandler` adapts it to Next. Phase 3's Expo app calls
the same routes, which is why the router was framework-agnostic before anything used it.

**Sign-up is server-side, in one step.** `POST /api/household` creates the auth user and
then the account, household and membership — the three platform tables no client may write.
Doing it the other way round leaves a window where somebody is authenticated with no
household, and every screen has to handle it. It is idempotent, because sign-up is where
people double-click.

## Known gaps, deliberately

**Sign-up confirms the email address itself.** `email_confirm: true` in
`app/api/household/route.ts`. Real public signup needs a confirmation flow — without one,
anybody can claim any address. One line, and whoever opens signup has to see it.

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
