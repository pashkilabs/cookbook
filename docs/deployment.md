# Deployment

What is deployed, where, and what is configured by hand. Everything here was previously known
only to whoever ran it.

The rule this file exists to serve: **hosted configuration is made by a script, not by clicking.**
Configuration nobody can review is configuration nobody notices drifting, which is the same reason
`check:parity` exists. Where a setting was set from a dashboard, that is called out as a gap.

---

## What is where

| | |
|---|---|
| **Web app** | Vercel, project `cookbook-web`, team Pashki (Hobby) |
| **Domain** | `https://cookbook.pashki.com` |
| **Repository** | `github.com/pashkilabs/cookbook`, `main`, auto-deploys |
| **Root directory** | `apps/web` |
| **Build** | `turbo run build`, install `pnpm install` |
| **Database + auth** | Supabase hosted, project `CookBook`, region `ca-central-1`, Postgres 17 |
| **Mail** | Resend, sending as `noreply@pashki.com` from the verified domain `pashki.com` |

Nothing else is deployed. `apps/mobile` and `apps/worker` do not exist, and the import queue is
drained by the web app while somebody has the batch screen open — there is no scheduler
(decisions §31).

### DNS

`cookbook.pashki.com` is a CNAME managed at **Squarespace**, where the whole `pashki.com` zone
lives. The apex points elsewhere (Netlify) and is not ours to touch.

The CNAME currently targets `cookbook-web-eta.vercel.app`, the project's generated alias, rather
than `cname.vercel-dns.com`. **This works but is fragile:** that alias is derived from the project
name, so renaming the project breaks the domain with no warning. Vercel documents the `cname`
target as the supported one.

Resend's records — an MX and TXT on `send.`, and a DKIM TXT at `resend._domainkey` — are in the
same zone and must survive any tidying.

---

## Environment

### Vercel — production

Seven variables. Six are required; the app refuses to start without them rather than guessing.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable; reaches the browser by design |
| `SUPABASE_SERVICE_ROLE_KEY` | bypasses RLS — server only, never in a client bundle |
| `PASHKI_TOKEN_KEY_ID` | `dev-1` |
| `PASHKI_TOKEN_PRIVATE_KEY` | **must be a real multi-line PEM** — see below |
| `NEXT_PUBLIC_SITE_URL` | `https://cookbook.pashki.com`, **Production scope only** — see below |
| `PASHKI_DEV_ISSUE_ENTITLEMENT` | **deliberately absent** — see below |

**Turborepo filters the environment per task.** A variable set on the host but not declared in
`turbo.json` is stripped before the build sees it: `NEXT_PUBLIC_*` passes by framework inference,
everything else must be listed under the `build` task's `env`. Adding a variable to Vercel without
adding it there produces a build that fails for reasons that have nothing to do with the change.

**The private key is the one that bites.** In `.env.local` it is a quoted single line containing
literal `\n`, because dotenv expands those. Vercel does not — it stores the value verbatim, and
`createPrivateKey` rejects it. Paste it with real line breaks. It fails at *runtime*, when a
household is provisioned, not at build, so a deploy looks green until somebody signs up.

### `NEXT_PUBLIC_SITE_URL` is Production-scoped

Preview deployments do not get one, so `siteUrl()` throws there and sign-up and resend return 500.
**That is deliberate**, and the reasoning is in `apps/web/lib/site-url.ts` — briefly: sharing
production's value mails preview signups a production link, and deriving one from `VERCEL_URL`
would require a `vercel.app` wildcard in GoTrue's redirect allow list, which is the only thing
stopping a session being handed to a host we do not control.

Everything except those two routes works on a preview. **Auth is tested locally against Mailpit,
or against production.**

### `PASHKI_DEV_ISSUE_ENTITLEMENT` is not set, and should not be

The flag issues an entitlement to whoever signs up. The domain is public, signup has no CAPTCHA
and no IP rate limit, so on a deployed host it is an unpriced free tier for anyone who finds the
URL. It exists for a developer running the app locally before billing is built.

Households are entitled **one at a time, by an operator**:

```bash
pnpm --filter @pashki/db issue:entitlement --email someone@example.com --dry-run
pnpm --filter @pashki/db issue:entitlement --email someone@example.com --days 365 --imports 500
```

The address must already have a household — provisioning happens at first confirmed sign-in and
nowhere else, so a person signs up, confirms, signs in once, and *then* is granted access.

### Local credentials

Hosted credentials live in `~/.pashki-supabase.env`, outside the repository, mode 600. Nothing
sources it automatically:

```bash
set -a && . ~/.pashki-supabase.env && set +a
```

Without it the Supabase CLI reports `LegacyPlatformAuthRequiredError` — "access token not
provided" — which reads like an expired token and is not. It holds `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD` and the `PASHKI_SMTP_*` values.

Use `SUPABASE_DB_PASSWORD` rather than the CLI's `--password` flag: the flag builds a connection
URI without percent-encoding and truncates this password at its `#`.

---

## Configuring the hosted project

All three run from `packages/db` — the Supabase CLI takes its project id from the working
directory, and from the repository root it reports "supabase start is not running" and changes
nothing. All three read back rather than trusting a 200, and all three report **three** outcomes:
applied `0`, refused `1`, could-not-measure `2`.

### Schema

```bash
pnpm --filter @pashki/db db:push:dry     # always first
pnpm --filter @pashki/db db:push
pnpm --filter @pashki/db check:parity    # always after
```

Local is a *stricter* environment than hosted for table privileges — hosted grants `ALL` on new
public tables to `anon` and `authenticated`, the local image does not. A local green is not
evidence. `check:parity` compares schema, privileges and auth settings, and is the only thing that
catches the difference.

### Mail — `set:smtp`

```bash
pnpm --filter @pashki/db set:smtp --dry-run
pnpm --filter @pashki/db set:smtp
```

Reads `PASHKI_SMTP_HOST`, `_PORT`, `_USER`, `_PASS`, `_SENDER_EMAIL`, `_SENDER_NAME` and
`PASHKI_EMAIL_RATE_LIMIT` from the environment; refuses a partial configuration rather than
half-applying one. Currently Resend on `smtp.resend.com:465` at 100 emails/hour.

Without a provider Supabase sends **2 emails per hour for the entire project**. The account is
created and the send is refused afterwards, so there is no error anywhere to see. Decisions §34.

### Redirects — `set:site-url`

```bash
pnpm --filter @pashki/db set:site-url https://cookbook.pashki.com --dry-run
pnpm --filter @pashki/db set:site-url https://cookbook.pashki.com
```

Sets `site_url` and `uri_allow_list` together, because setting one without the other *is* the bug:
GoTrue does not refuse an unlisted `redirect_to`, it silently substitutes `site_url`. Localhost
entries are preserved so `pnpm dev` keeps working.

`NEXT_PUBLIC_SITE_URL` on Vercel must match exactly, and is compiled into the bundle — changing it
requires a redeploy.

### Set from a dashboard, not a script

- The Vercel project itself: root directory, domain, and the seven variables.
- Squarespace DNS.
- The Resend account, its verified domain and its API key.

These are the drift surface. `check:parity` covers Supabase and knows nothing about Vercel.

---

## Verifying a deployment — `pnpm smoke`

```bash
pnpm smoke                                  # production
pnpm smoke http://127.0.0.1:3000 --local    # a local production build
```

41 checks across every route class: it signs up, confirms, provisions, writes a recipe, imports
one, queues a batch, drains it, plans a week, ticks a shopping line, puts an object in storage and
proves anon cannot read it — then deletes everything it made. Three exit codes: `0` verified, `1`
broken, `2` the host never answered.

**Any 500 is a failure.** A 401 means the handler ran and refused; a 500 means nothing ran. That
single rule is what would have caught the sharp fault on day one.

It reads `/api/health` first, so the run states which commit it tested and which configuration
keys are present (booleans only — never values). "Not deployed yet" stops being a hypothesis.

### It runs itself

`.github/workflows/smoke.yml` runs on every push to `main` and on demand. It **waits for the
pushed commit to actually be serving**, polling `/api/health`, before testing anything — testing
whichever build happens to answer is how a fix gets declared deployed when it is not. If the
deployment never serves that commit, the job fails rather than passing quietly.

**What it costs, stated plainly:**

- **The service-role key must exist in GitHub Actions secrets.** That is a real expansion of where
  a key that bypasses RLS lives — now Vercel, a developer machine, and GitHub. It is the price of
  the test being able to create and destroy a household the way a person would.
- **It writes to production.** A real account, household, recipe, import job and storage object,
  deleted in a `finally` block. A crashed runner can leave a `pashki-smoke+…@example.invalid`
  account behind; they are safe to delete.
- **A few minutes per deploy**, most of it waiting for Vercel.
- **It spends one import** against the smoke household's own grant, and briefly fetches a real
  recipe site.

The alternative — remembering to run it — is what produced the fault it exists to catch.

## Verifying by hand

The build passing proves nothing about auth. What proves it:

1. `POST /api/signup` with a fresh plus-addressed address → `202`.
2. Resend's API reports the message `delivered`.
3. The `redirect_to` inside the emailed link is the deployed domain, not `localhost`.
4. Following the link returns `303` to the app with a session and `email_verified: true`.
5. Signing in and calling `POST /api/household` provisions — **this is the step that exercises
   `PASHKI_TOKEN_PRIVATE_KEY`**, and the only one that catches a mis-pasted PEM.

Then delete the test account and its household. Last run: all five passed against
`cookbook.pashki.com`.

---

## What still stands between this and public signup

Sending was the blocker that could be removed. It was not the only one.

1. **Billing does not exist.** No Stripe, no webhook, no entitlement issuance. Blocked on Apple's
   outside-purchase rules (open question 1). Until then every household is entitled by hand, which
   is the reason the dev flag stays off.
2. **No abuse controls on signup.** No CAPTCHA, no IP rate limit. There is a per-address limit of
   2/hour in `apps/web/lib/rate-limit.ts` and nothing on the address space as a whole. Supabase's
   own `/auth/v1/signup` is reachable directly with the publishable key, so our route is not the
   only door.
3. **Address enumeration through Supabase's endpoint.** Our signup route answers identically for a
   new and an existing address; `/auth/v1/signup` answers with `identities: []` for one that
   exists. That is a project setting, not our code.
4. **The import queue has no scheduler.** A batch drains only while the page is open. Decisions
   §31.
5. **Abandoned imports orphan stored photos.** No reaper; an object with no `photos` row is
   unreachable and never collected.
6. **Exposed credentials pending rotation.** The Supabase access token, database password and
   service-role key have all been through a terminal session.
7. **The CNAME targets a generated alias**, so renaming the Vercel project breaks the domain.

None of 1–3 matter while the URL is unadvertised and entitlements are granted by hand. All of
1–3 matter the day it is not.
