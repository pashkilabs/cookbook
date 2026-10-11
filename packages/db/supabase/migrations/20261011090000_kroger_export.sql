-- ---------------------------------------------------------------------------
-- Sending the week's list to a Kroger cart (§74, §75).
--
-- Two things, and the second is the only thing standing between a household and
-- a doubled grocery order.
--
-- ---------------------------------------------------------------------------
-- The store, because product search and pricing both need one
-- ---------------------------------------------------------------------------
--
-- `kroger_location_id` sits beside `timezone`, `measurement_system` and
-- `avoided_allergens`: a household setting, written through the seam, no client
-- grant. §75 measured why it matters — the aisle in the product response is the
-- aisle in *this* store, which is what makes the export better than the in-app
-- list for shopping in person rather than worse.
--
-- ---------------------------------------------------------------------------
-- `cart_exports`: the cart cannot be read, so this is the only memory of it
-- ---------------------------------------------------------------------------
--
-- `PUT /v1/cart/add` is add-only — confirmed by probe, not assumed: the path
-- answers PUT and 404s on GET, and `/v1/cart` is not a route at all. So a second
-- send doubles the order and **nothing can detect it afterwards**.
--
-- Three behaviours follow, and the shape of this table is what makes them
-- possible:
--
--   line_keys    stored, not just a digest. A digest answers "the same list?"
--                and nothing else; the keys let a changed list send **only the
--                delta**, because the unchanged lines are already in the cart.
--   status       written as `intent` BEFORE the request leaves. A timed-out
--                request cannot be known to have landed, and with money the
--                asymmetry is plain: under-sending costs somebody adding one
--                item by hand, double-sending costs a duplicate order. So an
--                unknown outcome stays `intent` and is treated as sent.
--   fingerprint  over the whole serialised body, not a chosen subset —
--                `prompt-version.ts` failed by covering every input the recipe
--                carried and omitting the prompt.
--
-- No token is stored, anywhere, deliberately. A Kroger refresh token lives six
-- months and places orders on a person's account; an access token lives thirty
-- minutes and an export takes seconds, so the authorisation runs per export and
-- nothing is persisted. What a refresh token would buy is unattended use — a
-- cart filled with nobody present — and this project already forbids that shape
-- (*every import passes a review screen*). **The capability the credential
-- enables is one we have already decided against** (§74), which is why not
-- holding it costs nothing.
-- ---------------------------------------------------------------------------

alter table public.families
  add column kroger_location_id text
    constraint families_kroger_location_is_plausible
      -- their location ids are short digit strings; a free-text column would happily hold a URL
      check (kroger_location_id is null or kroger_location_id ~ '^[0-9]{6,10}$');

comment on column public.families.kroger_location_id is
  'The Kroger store this household shops at. Required for product search and for pricing, and the aisle in a product response is this store''s aisle (§75). A household setting beside timezone and measurement_system: written through the seam, never by a client.';

create table public.cart_exports (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  week_start date not null,
  /*
   * `intent` is written before the request leaves and only ever moves forward. There is no
   * `failed` that means "safe to resend": the cart cannot be read, so a request that did not
   * obviously succeed is indistinguishable from one that did.
   */
  status text not null default 'intent' check (status in ('intent', 'sent', 'refused')),
  /** the ShoppingLine keys sent, so a later export can offer only what is new */
  line_keys text[] not null default '{}'::text[],
  /*
   * The approved UPCs and quantities, held here between the redirect and the callback.
   *
   * They cannot ride in the OAuth `state`: Kroger echoes that back verbatim and a person can edit
   * it, so a basket could be rewritten on the way through. And they cannot be re-derived in the
   * callback by searching again — a second search can return different products, which would mean
   * sending something the household never reviewed. §75 is the reason that matters: the review
   * screen is the mechanism, so what was reviewed is exactly what must be sent.
   */
  items jsonb not null default '[]'::jsonb
    constraint cart_exports_items_is_a_list check (jsonb_typeof(items) = 'array'),
  /** a fingerprint of the whole serialised request body */
  body_fingerprint text not null,
  /** which Kroger environment this went to — a CE cart is not a production cart */
  environment text not null check (environment in ('certification', 'production')),
  item_count integer not null default 0 check (item_count >= 0),
  /** their HTTP status, kept because "no answer" and "an answer we did not like" differ */
  response_status integer,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index cart_exports_week on public.cart_exports (family_id, week_start)
  where deleted_at is null;

comment on table public.cart_exports is
  'What has been sent to a Kroger cart, because the cart itself cannot be read. line_keys rather than only a digest, so a changed list can send the delta instead of doubling what is already there (§74).';

alter table public.cart_exports enable row level security;

create policy cart_exports_select_in_household on public.cart_exports
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

/*
 * No client INSERT or UPDATE policy at all, deliberately.
 *
 * A row here is a claim that money was spent, and the only thing entitled to make it is the route
 * that made the request — which holds the service role. A client that could write this could
 * erase the record of a send and then send again, which is the one failure this table exists to
 * prevent. Reading is enough for a screen to say "you sent this on Tuesday".
 */
revoke all on public.cart_exports from anon, authenticated;
grant select on public.cart_exports to authenticated;
grant select, insert, update, delete on public.cart_exports to service_role;

create trigger set_updated_at before update on public.cart_exports
  for each row execute function private.set_updated_at();

create trigger propagate_delete_to_cart_exports_family_id
  after update of deleted_at on public.families
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete(
    'cart_exports', 'family_id', 'tombstone');

create trigger restore_delete_to_cart_exports_family_id
  after update of deleted_at on public.families
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.restore_soft_delete(
    'cart_exports', 'family_id');

create or replace function private.assert_cart_is_write_only_and_remembered()
returns void
language plpgsql
as $$
begin
  -- without the keys a changed list can only be resent whole, which doubles the unchanged lines
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cart_exports' and column_name = 'line_keys'
  ) then
    raise exception 'cart_exports has no line_keys, so a second export cannot send only the delta and would double everything already in the cart (§74)';
  end if;

  -- a CE cart and a production cart are different carts; a row that cannot say which is useless
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cart_exports'::regclass
      and conname like '%environment%'
  ) then
    raise exception 'cart_exports does not record which Kroger environment a send went to — a certification cart is not a production cart';
  end if;

  /*
   * No token column, ever. §74 settled this by *not holding* a credential rather than by holding
   * it carefully, so the way it goes wrong is somebody later adding what looks like a
   * convenience. A six-month refresh token that places grocery orders is not a convenience.
   */
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('cart_exports', 'families', 'accounts')
      and column_name in ('kroger_refresh_token', 'kroger_access_token', 'refresh_token', 'kroger_token')
  ) then
    raise exception 'a Kroger token column exists — §74 decided not to HOLD one: the access token lives 30 minutes and an export takes seconds, and what a refresh token buys is unattended use, which this project already forbids';
  end if;

  if exists (
    select 1 from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'cart_exports'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'a client can write cart_exports — it could erase the record of a send and then send again, which is the doubling this table exists to prevent';
  end if;
end;
$$;

-- restated in full: this is one function each migration replaces, and an environment
-- running an older body passes its own checks while missing the newer rule
create or replace function private.assert_rls_invariants()
returns void
language plpgsql
as $outer$
begin
  perform private.assert_household_invariants();
  perform private.assert_soft_delete_propagation();
  perform private.assert_no_anon_reads();
  perform private.assert_photo_storage_policies();
  perform private.assert_source_photos_never_public();
  perform private.assert_birth_year_stays_in_platform();
  perform private.assert_blends_never_public();
  perform private.assert_public_reads_revoked();
  perform private.assert_times_made_is_derived();
  perform private.assert_import_drain_retired();
  perform private.assert_pantry_base_is_countable();
  perform private.assert_preferences_carry_no_score();
  perform private.assert_allergens_are_household_wide();
  perform private.assert_cart_is_write_only_and_remembered();
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;

do $do$
declare
  grantee text;
begin
  for grantee in select unnest(array['authenticated', 'anon']) loop
    if has_column_privilege(grantee, 'public.families'::regclass, 'kroger_location_id', 'UPDATE') then
      raise exception 'a client can write families.kroger_location_id directly — it is a platform setting';
    end if;
  end loop;

  -- the check has to refuse something, and the predicate is tested where no row is needed
  if '12345678' !~ '^[0-9]{6,10}$' or 'https://evil' ~ '^[0-9]{6,10}$' then
    raise exception 'the kroger_location_id check does not separate a store id from arbitrary text';
  end if;
end;
$do$;
