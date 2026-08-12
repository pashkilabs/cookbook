-- Composite family keys, on every household reference rather than most of them.
--
-- Every household table carries family_id so no policy has to join, and what keeps
-- that denormalisation honest is a composite foreign key: a child references
-- (parent_id, family_id) together, so a row claiming a household its parent does not
-- belong to fails at write time.
--
-- Seven of the nine references to a household table were composite. Two were not:
-- ratings.family_member_id and recipes.created_by pointed at family_members by id
-- alone, so a rating in one household could be attributed to a person in another,
-- and a recipe could name a stranger as its author. Nothing would refuse it, nothing
-- would log it, and RLS would still scope the read — so the row simply renders with
-- a missing name. That is the quiet failure this whole pattern exists to prevent, and
-- it survived because the constraints are hand-written per table.
--
-- So: close the two, and then stop relying on remembering. The rule becomes an
-- invariant in private.assert_rls_invariants(), which every migration that adds a
-- table already calls, and the next single-column reference fails the migration.

alter table public.family_members
  add constraint family_members_id_family_id unique (id, family_id);

alter table public.ratings
  drop constraint ratings_family_member_id_fkey,
  add constraint ratings_family_member foreign key (family_member_id, family_id)
    references public.family_members (id, family_id) on delete cascade;

-- The column list on SET NULL matters: without it, deleting a member would try to
-- null family_id too, which is NOT NULL, and the delete would fail instead of the
-- recipe outliving its author. Postgres 15 and later only.
alter table public.recipes
  drop constraint recipes_created_by_fkey,
  add constraint recipes_created_by foreign key (created_by, family_id)
    references public.family_members (id, family_id)
    on delete set null (created_by);

-- created_by stays nullable, and MATCH SIMPLE means a null author skips the check
-- rather than failing it — which is what "imported, nobody typed it" needs.

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
end;
$fn$;

comment on function private.assert_rls_invariants is
  'Asserts the household-table invariants: reads never depend on billing, writes always do, updated_at is maintained, and references between household tables carry family_id. Call from every migration that adds a table.';

do $do$ begin perform private.assert_rls_invariants(); end; $do$;

-- The FK does not police family_id against families on its own: recipes.family_id
-- still references families directly, and that reference is single-column because
-- families has no family_id of its own to pair with. The invariant skips it for that
-- reason rather than by name.
do $do$
begin
  if (
    select count(*)
    from pg_constraint fk
    join pg_class child on child.oid = fk.conrelid
    join pg_namespace n on n.oid = child.relnamespace and n.nspname = 'public'
    where fk.contype = 'f'
      and fk.confrelid = 'public.family_members'::regclass
      and array_length(fk.conkey, 1) = 2
  ) <> 2 then
    raise exception 'both references to family_members should now be composite';
  end if;
end;
$do$;
