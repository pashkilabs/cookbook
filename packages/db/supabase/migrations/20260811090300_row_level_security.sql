-- Row-level security. Household isolation is a database guarantee here, not
-- application logic anybody has to remember.
--
-- Every policy follows the documented shape for performance as well as
-- correctness:
--
--   * `to authenticated` — without a role, the policy is also evaluated for anon
--     on every row, for nothing.
--   * `(select auth.uid())` inside private.current_family_ids(), so the planner
--     caches it per statement instead of calling it per row.
--   * family_id indexed on every table that has one (previous migration).
--
-- Tombstones stay readable on purpose. No policy filters `deleted_at is null` —
-- a deleted row a peer cannot see is indistinguishable from a row that never
-- synced, which is how a recipe deleted on one phone comes back from another.
-- Hiding tombstones is the application's job at query time, not RLS's.

-- ---------------------------------------------------------------------------
-- Grants: the gate outside RLS.
--
-- Postgres checks table privileges BEFORE it evaluates row-level security. The two
-- are independent and neither implies the other: a table with perfect policies and
-- no grant is unreachable, and a table with grants and no policies is wide open.
--
-- These are explicit because Supabase's default privileges do not cover them. On
-- the current image, the default ACL for role `postgres` in schema public grants
-- client roles only Dxtm — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN — and no DML at
-- all, while `supabase_admin` gets the full set:
--
--   postgres | public | r | {postgres=arwdDxtm/postgres, anon=Dxtm/postgres,
--                            authenticated=Dxtm/postgres, service_role=Dxtm/postgres}
--
-- Migrations run as `postgres`, so every table here came out with no SELECT for
-- anyone. That fails closed — the schema looks secure and the application is
-- simply dead — which is exactly the kind of thing that reads as an app bug for a
-- day before anyone suspects grants.
--
-- Deliberately not using `alter default privileges` to paper over it: a new table
-- should require a stated decision about who may touch it.
-- ---------------------------------------------------------------------------

-- The service role runs imports, webhooks and seeding. It bypasses RLS but still
-- needs table privileges like any other role — bypassing row security is not the
-- same as being granted access to the table.
grant select, insert, update, delete on all tables in schema public to service_role;

-- Household tables: full CRUD, with RLS deciding which rows.
grant select, insert, update, delete on
  public.recipes,
  public.recipe_ingredients,
  public.ratings,
  public.meal_plans,
  public.plan_entries,
  public.shortlist_entries,
  public.pantry_items,
  public.photos,
  public.import_jobs
to authenticated;

-- Platform tables and the catalog: read-only to clients. Every platform mutation
-- goes through packages/platform-client on the service role.
grant select on
  public.accounts,
  public.families,
  public.family_members,
  public.devices,
  public.subscriptions,
  public.entitlements,
  public.ingredients,
  public.grocery_packages
to authenticated;

-- anon is granted nothing at all. There is no household data it should reach, and
-- public recipe pages are server-rendered through the service role rather than
-- with an anon key. import_cache likewise stays service-role-only: it is shared
-- across the entire user base, so no client may read it.

-- ---------------------------------------------------------------------------
-- The lookup every policy below depends on.
--
-- Created here rather than with the other helpers because it is LANGUAGE sql:
-- Postgres parse-analyses the body at creation time, so family_members has to
-- exist first.
--
-- SECURITY DEFINER is load-bearing, not laziness. Every household policy needs to
-- consult family_members, and family_members is itself protected by RLS — a policy
-- that queried it as the caller would re-enter that table's own policy and
-- recurse. Running as the owner breaks the cycle.
--
-- search_path is pinned empty and every name fully qualified, which is what stops
-- a caller shadowing `public` with their own family_members and lifting the whole
-- isolation guarantee.
--
-- STABLE lets the planner evaluate it once per statement rather than once per row.
-- ---------------------------------------------------------------------------

create or replace function private.current_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select fm.family_id
  from public.family_members fm
  where fm.account_id = (select auth.uid())
    and fm.deleted_at is null
$$;

comment on function private.current_family_ids is
  'Families the authenticated account is a member of. SECURITY DEFINER to avoid recursing through family_members RLS.';

-- ---------------------------------------------------------------------------
-- Household tables: full CRUD, scoped to the caller's families.
--
-- Written as a loop rather than 36 hand-copied policies. The security property
-- that matters most is that every one of these tables is treated identically —
-- a loop cannot give one table a subtly different predicate or miss one
-- entirely, and the isolation tests assert the resulting policy set.
-- ---------------------------------------------------------------------------

do $do$
declare
  target text;
  household_tables text[] := array[
    'recipes',
    'recipe_ingredients',
    'ratings',
    'meal_plans',
    'plan_entries',
    'shortlist_entries',
    'pantry_items',
    'photos',
    'import_jobs'
  ];
begin
  foreach target in array household_tables loop
    execute format('alter table public.%I enable row level security', target);

    execute format($p$
      create policy %I on public.%I
        for select to authenticated
        using (family_id in (select private.current_family_ids()))
    $p$, target || '_select_in_household', target);

    execute format($p$
      create policy %I on public.%I
        for insert to authenticated
        with check (family_id in (select private.current_family_ids()))
    $p$, target || '_insert_in_household', target);

    -- both clauses matter: `using` stops a caller reaching another household's
    -- row, `with check` stops them moving one of their own rows into a household
    -- they don't belong to by writing a different family_id.
    --
    -- Worth knowing before anyone tunes this: Postgres also checks the NEW row of
    -- an UPDATE against the SELECT policy, so while SELECT stays restrictive it
    -- masks this policy entirely — weakening it changes no observable behaviour,
    -- which is verified in scripts/mutate-rls.sh. If public recipe pages ever
    -- loosen the SELECT policy, this policy stops being redundant and becomes the
    -- only guard. Re-run the mutation harness then.
    execute format($p$
      create policy %I on public.%I
        for update to authenticated
        using (family_id in (select private.current_family_ids()))
        with check (family_id in (select private.current_family_ids()))
    $p$, target || '_update_in_household', target);

    execute format($p$
      create policy %I on public.%I
        for delete to authenticated
        using (family_id in (select private.current_family_ids()))
    $p$, target || '_delete_in_household', target);
  end loop;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Platform tables: read-only to clients.
--
-- App code must not touch these at all (decisions §10) and every mutation —
-- creating a household, adding a member, registering a device, issuing an
-- entitlement — goes through packages/platform-client using the service role,
-- which bypasses RLS. Granting clients no write path is the cheap half of
-- enforcing that seam; the other half is discipline in the application layer.
-- ---------------------------------------------------------------------------

alter table public.accounts enable row level security;

-- own row only. A co-parent's email is not needed to render the app —
-- family_members.display_name is — so accounts stays private even inside a
-- household.
create policy accounts_select_self on public.accounts
  for select to authenticated
  using (id = (select auth.uid()));

create policy accounts_update_self on public.accounts
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter table public.families enable row level security;

create policy families_select_own on public.families
  for select to authenticated
  using (id in (select private.current_family_ids()));

alter table public.family_members enable row level security;

create policy family_members_select_in_household on public.family_members
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

alter table public.devices enable row level security;

create policy devices_select_own on public.devices
  for select to authenticated
  using (account_id = (select auth.uid()));

alter table public.subscriptions enable row level security;

-- readable so the app can show billing state; writable only by the webhook
-- handler, which runs as the service role
create policy subscriptions_select_in_household on public.subscriptions
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

alter table public.entitlements enable row level security;

-- readable for display only. Never trust the client's reading of this row —
-- entitlement decisions are made server-side and travel in a signed token.
create policy entitlements_select_in_household on public.entitlements
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

-- ---------------------------------------------------------------------------
-- Catalog: global reference data. Readable by every signed-in user, writable
-- only by the service role that seeds it.
--
-- These are the two tables with no family_id by design — cream comes in pints
-- regardless of whose kitchen it is, and copying the catalog per household would
-- defeat the point of promoting it out of source code.
--
-- No anon policy: public recipe pages are server-rendered, so that path reads
-- through the server rather than with an anon key.
-- ---------------------------------------------------------------------------

alter table public.ingredients enable row level security;

create policy ingredients_select_all on public.ingredients
  for select to authenticated
  using (true);

alter table public.grocery_packages enable row level security;

create policy grocery_packages_select_all on public.grocery_packages
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- import_cache: RLS enabled, deliberately zero policies.
--
-- The cache is shared across the whole user base by design, so there is no
-- household predicate to write. Enabling RLS with no policies denies every
-- ordinary client outright — anon and authenticated see nothing at all — while
-- the import service, running as the service role, bypasses RLS and uses it
-- normally.
--
-- Enabling RLS with no policies is not the same as leaving RLS off. Off would
-- expose the whole table through the API to anyone holding the anon key.
-- ---------------------------------------------------------------------------

alter table public.import_cache enable row level security;

-- ---------------------------------------------------------------------------
-- Self-check: fail the migration rather than ship a hole.
--
-- The rule is that every table carrying family_id is protected. Asserting it here
-- means a table added without RLS breaks `supabase db reset` immediately, which is
-- a much shorter feedback loop than noticing in a test — or not noticing.
-- ---------------------------------------------------------------------------

do $do$
declare
  unprotected text[];
  unpolicied text[];
begin
  select coalesce(array_agg(c.relname order by c.relname), '{}')
  into unprotected
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'family_id' and a.attnum > 0
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if array_length(unprotected, 1) > 0 then
    raise exception
      'tables carry family_id but have row-level security disabled: %',
      array_to_string(unprotected, ', ');
  end if;

  -- RLS enabled with no policy denies everything, which is right for
  -- import_cache and wrong — silently — for a household table.
  select coalesce(array_agg(c.relname order by c.relname), '{}')
  into unpolicied
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'family_id' and a.attnum > 0
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid);

  if array_length(unpolicied, 1) > 0 then
    raise exception
      'tables carry family_id but have no policies, so they deny everything: %',
      array_to_string(unpolicied, ', ');
  end if;

  -- import_cache is the one table that SHOULD have no policies, and that has to
  -- be asserted positively. Two independent gates keep it shut: no grant to any
  -- client role, and RLS enabled with nothing to satisfy. A later `grant select`
  -- would quietly open the first, so the second is what has to hold.
  if not (select relrowsecurity from pg_class where oid = 'public.import_cache'::regclass) then
    raise exception 'import_cache has row-level security disabled; it would be readable by any client holding a grant';
  end if;

  if exists (select 1 from pg_policy where polrelid = 'public.import_cache'::regclass) then
    raise exception 'import_cache has a policy; it is shared across the whole user base and must not be reachable by clients';
  end if;

  if has_table_privilege('authenticated', 'public.import_cache', 'select')
     or has_table_privilege('anon', 'public.import_cache', 'select') then
    raise exception 'import_cache is granted to a client role; it must be service-role only';
  end if;
end;
$do$;
