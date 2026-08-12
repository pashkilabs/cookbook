# @pashki/platform-client

The seam. App code asks this package about accounts, households, entitlements and
quota, and never queries the platform tables itself.

Get this boundary right and extracting a real platform for app #2 is mechanical.
Get it wrong and it is surgical. `scripts/check-platform-tables.mjs` fails
`pnpm check` if anything outside this package (or `packages/db`, which owns the
schema) touches `accounts`, `families`, `family_members`, `devices`,
`subscriptions` or `entitlements` — by supabase-js call or by raw SQL.

## Surface

```ts
const platform = createPlatformClient({
  store: createSupabasePlatformStore(serviceRoleClient),
  accountId,                       // the caller has already authenticated
  signer: createEd25519Signer({ keyId, privateKeyPem }),
});

await platform.getSession();                 // account, family, members
await platform.getEntitlement("recipes");    // tier, quota, window, access, token
await platform.consumeQuota("recipes", 1);   // allowed | exceeded | no-entitlement
await platform.registerDevice("ios");        // deviceId
```

## The HTTP surface

```ts
// a Next.js route handler is this and nothing more
export const GET = toFetchHandler(
  createPlatformRouter({
    authenticator: createSupabaseAuthenticator(serviceRoleClient),
    clientFor: (accountId) => createPlatformClient({ store, accountId, signer }),
  }),
  { basePath: "/api/platform" },
);
```

| | |
|---|---|
| `GET /session` | account, family, members |
| `GET /entitlement/:appKey` | access level, tier, quota, and the signed token |
| `POST /entitlement/:appKey/quota` | spend, `{ amount, quota? }` |
| `POST /devices` | register, `{ platform, deviceId? }` |

This package needs the service role, so it cannot run in a browser or an app bundle
(decisions §16). Web can call it server-side; Phase 3's Expo app cannot — these routes
are how native reaches the seam, drawn while nothing depends on them rather than with
the native app waiting.

**The security property is that there is no `accountId` parameter anywhere.** The
account is resolved from the caller's bearer token and handed to `clientFor`; no path,
query or body field can influence whose data comes back. That is structural rather than
validated — there is no check to get wrong, because there is nothing to check. Tested
with real Supabase JWTs: one household's token spending quota while naming the other
household in its body charges its own allowance and leaves the other untouched.

**The token is checked by the auth server, not verified locally.** No component here
holds the JWT secret, and a revoked session stops working immediately rather than at
expiry — which is what "sign out everywhere" has to mean. The cost is a network call per
request; the alternative is a secret in one more place and a revocation list to keep.

Authentication happens **before the route is matched**, so a caller without a token
cannot learn which routes exist. An auth-server outage answers 503, not 401 — telling
somebody their token is bad when the checker is down sends them to re-authenticate for
nothing.

**Quota spend is a caller of the existing function**, not a second implementation: it
goes through `consumeQuota` to the one atomic statement in the database. Exceeding it
answers 429 rather than 403, because the caller may succeed once the period rolls.

**The entitlement route returns the token, not the row.** A client gets the signed
artefact it can carry offline plus what it needs to render — never the entitlement
record, which is platform-owned and would invite clients to reason about it.

Framework-agnostic by design: the router works over plain objects so it is testable
without constructing a `Request`, and `toFetchHandler` is the thin adapter to the Fetch
API that Next.js, Deno, Bun and Cloudflare all speak. One implementation, two hosts.

## Three entry points, on purpose

| | |
|---|---|
| `@pashki/platform-client` | types, client, access rules, token parsing. **No crypto, no database driver** — bundles for React Native |
| `@pashki/platform-client/crypto` | Ed25519 signing and verification. Server only |
| `@pashki/platform-client/supabase` | the Supabase `PlatformStore`. Server only, service role |
| `@pashki/platform-client/auth` | the Supabase token authenticator. Server only |

Splitting them is not tidiness. If signing lived in the main entry, importing the
package anywhere in the Expo app would drag `node:crypto` into the bundle and
either fail the build or, worse, resolve to a polyfill that silently signs
nothing. Importing the crypto entry into a client bundle should fail loudly.

## The storage port

`PlatformStore` is the only interface that knows platform tables exist. Swapping
storage, or extracting a platform service for app #2, means writing another one —
no caller changes. The tests drive the client through an in-memory store, which is
the cheapest available proof that the abstraction actually holds rather than
merely existing.

## Entitlements

**Degradation is read-only, never locked.** After the grace window the app stops
writing and keeps reading. A family must not lose access to their own recipes
because a card expired mid-shop. `Access` has an always-true `canRead: true` field
rather than expressing that as an absence, so adding a locking state later is a
visible change to the type instead of something that slips in behind a boolean.
There is a test asserting no point on the timeline denies reading.

**Grace is a column, read not computed.** It used to be computed here on the reasoning
that grace is issuance policy — but once the database enforces read-only degradation
through an RLS predicate, the predicate and the token have to agree about when grace
ends, and the only way to guarantee that is for both to read `entitlements.grace_until`.
`graceUntilFor` remains for whoever issues an entitlement to compute a window with; it
is no longer consulted on the read path. Decisions §9.

**Boundaries are inclusive.** A token is valid *until* `validUntil`, so at exactly
that instant it is still valid. Same for grace. The other convention expires a
subscription a moment early and generates support mail.

## The token

```
pashki1.<keyId>.<payload base64url>.<signature base64url>
```

**No algorithm field.** The verifier knows it is Ed25519. Letting a token name its
own algorithm is how JWT libraries end up accepting `alg: none`, or being talked
into checking an RSA signature with an HMAC key. Nothing here negotiates, and
there is a test that a payload claiming `alg: none` changes nothing.

**Asymmetric, not an HMAC.** App #2's server can verify tokens the platform issued
while holding only a public key. A shared secret would mean everything that can
verify can also mint.

**Keyed by id, so rotation is possible.** A verifier holds several public keys
while tokens signed by a retired one are still inside their grace window. An
unknown key id is refused rather than triggering a search for a key that fits —
otherwise removing a key from the map would not actually retire it.

**Payload carries display names only.** No emails, no ratings. A leaked token must
not become a privacy incident.

`decodeUnverified()` is deliberately awkward to call by accident. It is legitimate
for exactly one thing: a device rendering its own entitlement offline. It is not a
security decision, and there is a test asserting it happily reads a forged token —
which is the point of the name.

## Quota is server-authoritative

The token carries the balance so an offline device can display "160 of 500". It is
a **snapshot**. Spending is always a server call, because two devices offline at
once would otherwise both believe they held the last import.

The spend is one conditional `UPDATE` in Postgres
(`public.platform_spend_quota`, service role only), not a read followed by a
write. Read-then-write lets two simultaneous requests both see 499/500 and both
write 500 — and it is invisible afterwards, because the numbers still look
plausible. There is an integration test that fires twenty concurrent spends
against a balance of eight and asserts exactly eight succeed.

A counter that does not exist is a refusal, not an unmetered allowance.

## Not here, on purpose

- **No Stripe or RevenueCat.** Separate task, and Apple's outside-purchase rules
  are unresolved in `docs/decisions.md`. Nothing in this package assumes how a
  subscription is sold: `subscriptions` is `provider` + `external_id`.
- **No sign-in UI.** The caller authenticates and hands over an `accountId`.
- **One tier.** `Tier` is `"full"`. Tier design is a product decision.
- **Quota numbers are not invented here.** They arrive when an entitlement is
  issued. Whether there is a free tier at all is still open, and it changes the
  numbers rather than the mechanism.
