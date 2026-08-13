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
-- **Environments do not agree on what "default" means, so this starts from nothing.**
-- The local image narrows the default ACL as above. Hosted Supabase does the opposite:
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
--     TO anon, authenticated, service_role
--
-- so every table created here is born with SELECT, INSERT, UPDATE and DELETE for
-- `anon`. Found by pushing to a hosted project: the self-check at the bottom of this
-- file refused the migration because `import_cache` — shared across the entire user
-- base — was readable by any client. Only RLS was standing between anon and the
-- grocery catalog, and grants are supposed to be the gate *outside* RLS.
--
-- So: revoke everything from client roles, then grant back deliberately. And narrow
-- the default, which is what actually enforces the principle that a new table
-- requires a stated decision about who may touch it — under a permissive default,
-- the decision gets made by nobody.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

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
-- May this household still write?
--
-- Row-level security proves which household a row belongs to. On its own it never
-- asks whether that household is still paid up, which left read-only degradation
-- as a thing the client politely observed — a lapsed family could write through the
-- API all day. This predicate is what makes decisions §9 a guarantee.
--
-- It is applied to insert, update and delete policies and **never to select**.
-- That is the whole design: there is no code path that can deny a read, so
-- read-only is the floor by construction rather than by discipline. The self-check
-- at the end of this file asserts no SELECT policy ever references it.
--
-- `now() <= grace_until` is inclusive, matching evaluateAccess in
-- packages/platform-client so the client and the database agree to the millisecond
-- about when writing stops.
--
-- The service role bypasses RLS, so server-side work — issuing entitlements,
-- webhooks, the import service — is unaffected. That is correct: the server is the
-- thing deciding, and it must be able to write for a household that cannot.
-- ---------------------------------------------------------------------------

create or replace function private.household_can_write(p_family_id uuid, p_app_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.entitlements e
    where e.family_id = p_family_id
      and e.app_key = p_app_key
      and now() <= e.grace_until
  )
$$;

comment on function private.household_can_write is
  'True while the household is inside its entitlement window including grace. Used by write policies only — never by a SELECT policy, so reading never depends on billing.';

-- ---------------------------------------------------------------------------
-- Household tables: full CRUD, scoped to the caller's families.
--
-- Written as a loop rather than 36 hand-copied policies. The security property
-- that matters most is that every one of these tables is treated identically —
-- a loop cannot give one table a subtly different predicate or miss one
-- entirely, and the isolation tests assert the resulting policy set.
-- ---------------------------------------------------------------------------

-- 'recipes' is this app's key. These are recipe-app tables; when app #2 adds its
-- own, its policies pass its own key, and a household entitled to one app cannot
-- write another's data.
do $do$
declare
  target text;
  app_key constant text := 'recipes';
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

    -- writes additionally require a live entitlement; reads never do
    execute format($p$
      create policy %I on public.%I
        for insert to authenticated
        with check (
          family_id in (select private.current_family_ids())
          and private.household_can_write(family_id, %L)
        )
    $p$, target || '_insert_in_household', target, app_key);

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
    -- The entitlement check goes in `with check`, not `using`. A lapsed household
    -- can still *reach* its rows — which is what keeps reading intact — and the
    -- write fails loudly with a policy violation the API can turn into "you are
    -- read-only" rather than a silent zero-rows-updated that looks like the row
    -- had vanished.
    execute format($p$
      create policy %I on public.%I
        for update to authenticated
        using (family_id in (select private.current_family_ids()))
        with check (
          family_id in (select private.current_family_ids())
          and private.household_can_write(family_id, %L)
        )
    $p$, target || '_update_in_household', target, app_key);

    -- DELETE has no with-check clause, so this one is necessarily quiet: a lapsed
    -- household's delete matches no rows rather than raising. Refused either way.
    execute format($p$
      create policy %I on public.%I
        for delete to authenticated
        using (
          family_id in (select private.current_family_ids())
          and private.household_can_write(family_id, %L)
        )
    $p$, target || '_delete_in_household', target, app_key);
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

  -- The rest of the matrix, asserted where it is established. A permissive default
  -- privilege elsewhere would otherwise hand clients write access to the platform
  -- tables and the grocery catalog, with only RLS between them and it.
  declare
    writable text[];
  begin
    select coalesce(array_agg(t.name || ' (' || r.role || ')' order by t.name, r.role), '{}')
    into writable
    from (values
      ('public.accounts'), ('public.families'), ('public.family_members'),
      ('public.devices'), ('public.subscriptions'), ('public.entitlements'),
      ('public.ingredients'), ('public.grocery_packages')
    ) as t(name)
    cross join (values ('anon'), ('authenticated')) as r(role)
    where has_table_privilege(r.role, t.name::regclass, 'insert')
       or has_table_privilege(r.role, t.name::regclass, 'update')
       or has_table_privilege(r.role, t.name::regclass, 'delete');

    if array_length(writable, 1) > 0 then
      raise exception
        'platform tables and the catalog are read-only to clients, but a client role holds write privileges: %',
        array_to_string(writable, ', ');
    end if;
  end;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Self-check: reading must never depend on billing.
--
-- Read-only is the floor (decisions §9). The way that is guaranteed is that no
-- SELECT policy mentions household_can_write — so a lapsed household loses writes
-- and nothing else. Asserting it here means someone adding the predicate to a
-- SELECT policy for symmetry breaks `db reset` instead of quietly inventing a
-- locked state.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The invariants, as a callable function.
--
-- These were inline DO blocks, which meant they only ever described the schema as
-- it stood in *this* migration — a table added by a later one was never checked. A
-- function fixes that: every migration that adds a household table calls it, and
-- forgetting to is a failed `db reset` rather than a silent hole.
-- ---------------------------------------------------------------------------

create or replace function private.assert_rls_invariants()
returns void
language plpgsql
set search_path = ''
as $fn$
begin
  declare
    offenders text[];
  begin
    select coalesce(array_agg(c.relname || '.' || p.polname order by c.relname), '{}')
    into offenders
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where p.polcmd in ('r', '*')
      and coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%household_can_write%';
  
    if array_length(offenders, 1) > 0 then
      raise exception
        'a SELECT policy depends on the entitlement window, which would lock a household out of its own data: %',
        array_to_string(offenders, ', ');
    end if;
  
    -- and the converse: every household table's write policies must carry it, or one
    -- table silently stays writable after grace
    select coalesce(array_agg(distinct c.relname || ' ' || p.polname order by c.relname || ' ' || p.polname), '{}')
    into offenders
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'family_id'
    where p.polcmd in ('a', 'w', 'd')
      and c.relname not in ('subscriptions', 'entitlements', 'family_members')
      and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
          || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') not like '%household_can_write%';
  
    if array_length(offenders, 1) > 0 then
      raise exception
        'write policies without an entitlement check would stay writable after grace: %',
        array_to_string(offenders, ', ');
    end if;
  end;

  declare
    missing text[];
  begin
    select coalesce(array_agg(c.relname order by c.relname), '{}')
    into missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and a.attnum > 0
    where c.relkind = 'r'
      and not exists (
        select 1
        from pg_trigger t
        join pg_proc f on f.oid = t.tgfoid
        join pg_namespace fn on fn.oid = f.pronamespace
        where t.tgrelid = c.oid
          and not t.tgisinternal
          and fn.nspname = 'private'
          and f.proname = 'set_updated_at'
      );
  
    if array_length(missing, 1) > 0 then
      raise exception
        'tables have updated_at but no trigger to maintain it, which breaks last-write-wins: %',
        array_to_string(missing, ', ');
    end if;
  end;
end;
$fn$;

comment on function private.assert_rls_invariants is
  'Asserts the household-table invariants: reads never depend on billing, writes always do, and updated_at is maintained. Call from every migration that adds a table.';

do $do$ begin perform private.assert_rls_invariants(); end; $do$;

