-- Platform tables — Pashki-owned, per docs/architecture.md §5.
--
-- App code must never query these directly; it goes through
-- packages/platform-client (docs/decisions.md §10). That boundary is what makes
-- extracting a real platform for app #2 mechanical instead of surgical, and it is
-- a discipline in the application layer — nothing here can enforce it.

-- accounts.id IS auth.users.id.
--
-- The alternative — a surrogate key plus an auth_user_id column — would put an
-- extra hop inside every policy on every table, forever, to buy portability away
-- from an auth provider we have already committed to (docs/decisions.md §5).
-- Sharing the key means auth.uid() is directly comparable to accounts.id.
create table public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  -- mirrored from auth.users for joins and display. auth.users remains the
  -- authority on uniqueness; a second unique constraint here would only
  -- introduce a way for the two to disagree.
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Apple requires in-app account deletion. Soft first so a sync peer sees it.
  deleted_at timestamptz
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- restrict, not cascade: deleting the owner must not silently take the
  -- household's recipes with it. Account deletion is a flow that reassigns or
  -- tears down deliberately.
  owner_account_id uuid not null references public.accounts (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- family_members are not accounts. Adults have logins; children are rated but
-- never sign in. Keeping them separate is what lets a household rate a recipe for
-- a six-year-old without provisioning them an identity.
create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- null for a child, or for an adult who has not accepted an invite yet
  account_id uuid references public.accounts (id) on delete set null,
  display_name text not null,
  colour text,
  is_child boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- the invariant behind the split: a child never has a login
  constraint child_has_no_login check (not (is_child and account_id is not null))
);

-- one membership per account per household, ignoring tombstones so a person who
-- left can be re-added
create unique index family_members_one_per_account
  on public.family_members (family_id, account_id)
  where account_id is not null and deleted_at is null;

-- Device limits are enforced at sign-in against this table, not on every action
-- (architecture §6). revoked_at is this table's tombstone — a revoked device must
-- stay visible so the revocation propagates rather than looking like an absence.
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- provider + external_id only.
--
-- Stripe, the App Store and Play all get represented the same way. A
-- stripe_subscription_id column would invite a play_purchase_token beside it, and
-- then every read has to know which one to look at. Provider-specific payloads
-- belong in the webhook handler, not the schema.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'app_store', 'play')),
  external_id text not null,
  status text not null check (
    status in ('trialing', 'active', 'past_due', 'canceled', 'expired')
  ),
  renews_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- makes a replayed webhook an upsert rather than a duplicate subscription
  constraint subscriptions_provider_identity unique (provider, external_id)
);

-- What the signed entitlement token is minted from (architecture §6). The token
-- carries a grace window; that is an issuance policy, so it is deliberately not a
-- column here — decisions §9 keeps grace in the token, not the row.
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- 'recipes' is tenant #1. A second app adds a row, not a column.
  app_key text not null,
  tier text not null,
  -- the fair-use quota, shaped by whatever the app needs to meter. jsonb because
  -- the shape will move and this table should not need a migration each time.
  quota_json jsonb not null default '{}'::jsonb,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_one_per_app unique (family_id, app_key)
);

create index families_owner_account_id on public.families (owner_account_id);
create index family_members_account_id on public.family_members (account_id);
create index family_members_family_id on public.family_members (family_id);
create index devices_account_id on public.devices (account_id);
create index subscriptions_family_id on public.subscriptions (family_id);
create index entitlements_family_id on public.entitlements (family_id);

create trigger set_updated_at before update on public.accounts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.families
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.family_members
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.devices
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.entitlements
  for each row execute function private.set_updated_at();
