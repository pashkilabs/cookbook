-- Remove `accounts_update_self`, and assert the rule it was quietly contradicting.
--
-- The policy let a client update its own `accounts` row. It decided nothing, because
-- `authenticated` has never held UPDATE on `accounts` — column privileges are checked
-- before row-level security, so the write was refused before the policy was consulted.
--
-- A policy that decides nothing is worse than no policy, for a specific reason: **RLS
-- denies by default.** With no policy, a `GRANT UPDATE ON accounts TO authenticated` in
-- some future migration about something else still fails closed. With this policy present,
-- that same line silently opens client writes to the account table, and the migration that
-- did it would look like it was about grants.
--
-- Decision §16 is explicit that clients get SELECT on platform tables and no write path at
-- all; mutations go through `packages/platform-client` on the service role, and a client
-- that genuinely needs to write one gets a narrow RPC rather than the table. So this policy
-- was never the intended design — it was an unreachable draft of a different one.
--
-- Found by auditing client-writable tables, in the "dormant policy" sense rather than the
-- exploitable sense. Nothing was wrong. Something was one unrelated line away from being
-- wrong.

drop policy accounts_update_self on public.accounts;

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

  -- Platform tables are read-only to clients (decisions §16), and that has to be true of
  -- the *policies* as well as the grants. A write policy with no grant decides nothing
  -- today and decides everything the moment somebody adds the grant, because RLS denies by
  -- default and a policy is what stops it doing so.
  declare
    dormant text[];
  begin
    select coalesce(array_agg(c.relname || '.' || p.polname order by c.relname, p.polname), '{}')
    into dormant
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_roles r on r.oid = any (p.polroles)
    where c.relname in (
        'accounts', 'families', 'family_members', 'devices', 'subscriptions', 'entitlements'
      )
      and p.polcmd in ('a', 'w', 'd', '*')
      and r.rolname in ('anon', 'authenticated');

    if array_length(dormant, 1) > 0 then
      raise exception
        'a client write policy exists on a platform table; with no grant it decides nothing, and with one it opens the table (decisions §16): %',
        array_to_string(dormant, ', ');
    end if;
  end;

  -- And the same rule as a privilege, which is the half a permissive default privilege
  -- breaks. Hosted Supabase grants ALL on new public tables to anon and authenticated;
  -- 090300 revokes that and narrows the default, and this is what keeps it revoked.
  declare
    writable text[];
  begin
    select coalesce(array_agg(c.relname || ' (' || r.rolname || ')' order by c.relname, r.rolname), '{}')
    into writable
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
    where c.relkind = 'r'
      and c.relname in (
        'accounts', 'families', 'family_members', 'devices', 'subscriptions',
        'entitlements', 'ingredients', 'grocery_packages'
      )
      and (
        has_table_privilege(r.rolname, c.oid, 'INSERT')
        or has_table_privilege(r.rolname, c.oid, 'UPDATE')
        or has_table_privilege(r.rolname, c.oid, 'DELETE')
      );

    if array_length(writable, 1) > 0 then
      raise exception
        'platform tables and the catalog are read-only to clients, but a client role holds write privileges: %',
        array_to_string(writable, ', ');
    end if;

    -- import_cache belongs to nobody and must be reachable by no client at all
    if has_table_privilege('anon', 'public.import_cache', 'SELECT')
       or has_table_privilege('authenticated', 'public.import_cache', 'SELECT') then
      raise exception
        'import_cache is readable by a client role; it is shared across the whole user base';
    end if;
  end;
end;
$fn$;

comment on function private.assert_rls_invariants is
  'Asserts the household-table invariants: reads never depend on billing, writes always do, updated_at is maintained, references between household tables carry family_id, clients can neither stamp sync timestamps nor hard-delete a row with a tombstone, and no client write policy exists on a platform table. Call from every migration that adds a table.';

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
