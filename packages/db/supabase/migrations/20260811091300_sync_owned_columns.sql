-- Two things a client could do to a household row that sync cannot survive.
--
-- **1. Set its own `updated_at`.** `private.set_updated_at()` is a BEFORE **UPDATE**
-- trigger, so it maintains the column on every edit and never fires on an insert. A
-- client could therefore insert a row stamped any time it liked. Verified: a recipe
-- inserted with `updated_at = '3000-01-01'` was accepted and kept that value.
--
-- Under last-write-wins — which decisions §11 accepts precisely because the timestamp is
-- the database's, not the caller's — that row wins against every future edit from every
-- device, permanently. It is not a leak and it is not loud; it is a row that stops
-- accepting changes and no error anywhere. `created_at` is the same shape one step down:
-- it orders every list the app renders.
--
-- **2. Hard-delete it.** `authenticated` held DELETE on all ten household tables. But
-- architecture §5 says tombstones stay readable, because *a deleted row a peer cannot
-- see is indistinguishable from one that never synced* — and a hard delete is exactly
-- the row a peer cannot see. A client deleting rows outright would leave every offline
-- device holding data the server no longer has, with nothing to reconcile against.
--
-- So deletion for a client is `deleted_at`, which the write policies already gate on the
-- entitlement window. That has a second effect worth naming: decisions §9 recorded that a
-- lapsed household's DELETE is refused *quietly*, zero rows, because DELETE has no
-- `with check` clause to fail. Routed through an UPDATE it now fails loudly like every
-- other write. The wart is gone rather than documented.
--
-- The service role keeps DELETE. Teardown, reapers and the storage-orphan cleanup that
-- `docs/roadmap.md` still owes are all server operations, and they are the only things
-- that should ever make a row genuinely disappear.

do $do$
declare
  t text;
  cols text;
  -- every household table a client can write. import_jobs is already narrower than this
  -- (091100), so it appears only in the DELETE revocation below.
  household_tables text[] := array[
    'recipes', 'recipe_ingredients', 'recipe_steps', 'ratings', 'meal_plans',
    'plan_entries', 'shortlist_entries', 'pantry_items', 'photos'
  ];
begin
  foreach t in array household_tables loop
    -- INSERT: everything the row is, minus the two timestamps the database owns.
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into cols
    from pg_attribute a
    where a.attrelid = ('public.' || t)::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname not in ('created_at', 'updated_at');

    execute format('revoke insert on public.%I from authenticated', t);
    execute format('grant insert (%s) on public.%I to authenticated', cols, t);

    -- UPDATE: also minus identity. Re-keying a row or moving it between households is
    -- not an edit — RLS already refuses the move, and this refuses the attempt one layer
    -- earlier where there is nothing to reason about.
    -- photos is skipped: 091200 narrowed it further and this would widen it back.
    if t <> 'photos' then
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into cols
      from pg_attribute a
      where a.attrelid = ('public.' || t)::regclass
        and a.attnum > 0
        and not a.attisdropped
        and a.attname not in ('id', 'family_id', 'created_at', 'updated_at');

      execute format('revoke update on public.%I from authenticated', t);
      execute format('grant update (%s) on public.%I to authenticated', cols, t);
    end if;
  end loop;

  foreach t in array household_tables || array['import_jobs'] loop
    execute format('revoke delete on public.%I from anon, authenticated', t);
  end loop;
end;
$do$;

-- The DELETE policies stay. They are the correct policy if a client ever regains the
-- privilege, and RLS denies by default — so a grant restored without them would fail
-- closed, which is the wrong kind of surprise to arrange deliberately.

-- ---------------------------------------------------------------------------
-- Both rules become invariants, because the next table is where this is forgotten.
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
        'tables with updated_at but no trigger to maintain it: %',
        array_to_string(missing, ', ');
    end if;
  end;

  -- Every reference from one household table to another must carry family_id on both
  -- sides. A single-column reference lets a child row belong to one household while
  -- its parent belongs to another, and nothing downstream notices.
  declare
    single_column text[];
  begin
    select coalesce(array_agg(child.relname || '.' || fk.conname order by child.relname), '{}')
    into single_column
    from pg_constraint fk
    join pg_class child on child.oid = fk.conrelid
    join pg_namespace cn on cn.oid = child.relnamespace and cn.nspname = 'public'
    join pg_class parent on parent.oid = fk.confrelid
    join pg_namespace pn on pn.oid = parent.relnamespace and pn.nspname = 'public'
    join pg_attribute child_family
      on child_family.attrelid = child.oid
     and child_family.attname = 'family_id'
     and child_family.attnum > 0
    join pg_attribute parent_family
      on parent_family.attrelid = parent.oid
     and parent_family.attname = 'family_id'
     and parent_family.attnum > 0
    where fk.contype = 'f'
      and not (
        child_family.attnum = any (fk.conkey)
        and parent_family.attnum = any (fk.confkey)
      );

    if array_length(single_column, 1) > 0 then
      raise exception
        'references between household tables must include family_id, or a child can claim a household its parent is not in: %',
        array_to_string(single_column, ', ');
    end if;
  end;

  -- The sync conventions, as privileges rather than as intentions.
  declare
    writable text[];
    deletable text[];
  begin
    select coalesce(array_agg(c.relname || '.' || a.attname order by c.relname, a.attname), '{}')
    into writable
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind = 'r'
      and a.attname in ('created_at', 'updated_at')
      and exists (
        select 1 from pg_attribute f
        where f.attrelid = c.oid and f.attname = 'family_id' and f.attnum > 0
      )
      and (
        has_column_privilege('authenticated', c.oid, a.attname, 'INSERT')
        or has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE')
        or has_column_privilege('anon', c.oid, a.attname, 'INSERT')
        or has_column_privilege('anon', c.oid, a.attname, 'UPDATE')
      );

    if array_length(writable, 1) > 0 then
      raise exception
        'a client can stamp its own sync timestamps, and a row dated in the future wins last-write-wins forever: %',
        array_to_string(writable, ', ');
    end if;

    select coalesce(array_agg(c.relname order by c.relname), '{}')
    into deletable
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'r'
      and exists (
        select 1 from pg_attribute f
        where f.attrelid = c.oid and f.attname = 'deleted_at' and f.attnum > 0
      )
      and (
        has_table_privilege('authenticated', c.oid, 'DELETE')
        or has_table_privilege('anon', c.oid, 'DELETE')
      );

    if array_length(deletable, 1) > 0 then
      raise exception
        'a client can hard-delete rows that carry a tombstone column, and a peer cannot tell a deleted row from one that never synced: %',
        array_to_string(deletable, ', ');
    end if;
  end;
end;
$fn$;

comment on function private.assert_rls_invariants is
  'Asserts the household-table invariants: reads never depend on billing, writes always do, updated_at is maintained, references between household tables carry family_id, and clients can neither stamp sync timestamps nor hard-delete a row that has a tombstone. Call from every migration that adds a table.';

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
