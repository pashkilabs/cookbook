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
| `NEXT_PUBLIC_SITE_URL` | where this app is reachable. **Confirmation links are built from this, not from the request's `Host` header** — a Host is attacker-controlled, and letting it choose the link in an email is how confirmation links get poisoned. It must also be in the project's redirect allow list, path glob included, or GoTrue silently substitutes `site_url` |

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
