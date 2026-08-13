-- Deleting a recipe deletes what hangs off it.
--
-- `ON DELETE CASCADE` fires on a real DELETE. Clients have no DELETE (091300) because a
-- hard-deleted row is the one thing a peer cannot tell from a row that never synced — so every
-- deletion in this product is an UPDATE setting `deleted_at`, and the cascade never fires.
--
-- The result was a live bug: a tombstoned recipe stayed on the planner and kept contributing to
-- the shopping list, because its `plan_entries` were still live. Found while verifying the
-- shopping list, with a deleted recipe still buying ingredients.
--
-- ---------------------------------------------------------------------------
-- Why a trigger and not the delete route
-- ---------------------------------------------------------------------------
--
-- The route is where a reader would look, and a trigger is invisible from there. That is a real
-- cost and it is paid deliberately, because of what Phase 3 does:
--
-- **A sync engine writes rows to Postgres directly.** A device deleting a recipe offline will
-- replicate `deleted_at` into `recipes` without going near a Next.js route handler. Propagation in
-- the route would simply not happen for that delete, and the household would find the same bug
-- again from a phone. Nothing in the application layer can cover a writer that does not call it.
--
-- Two smaller reasons point the same way. A trigger cannot be forgotten by a future caller — the
-- import service, an admin script, a repair query — while a route is one of several doors. And it
-- fires inside the same statement as the parent update, so a device observes one consistent set of
-- tombstones rather than a parent that arrived before its children.
--
-- The invisibility is mitigated where it bites: `assert_rls_invariants()` fails if a new child
-- table has no propagation, `docs/decisions.md` §30 records the choice, and the delete route
-- carries a comment pointing here.
--
-- ---------------------------------------------------------------------------
-- What a device sees
-- ---------------------------------------------------------------------------
--
-- Every child gets `deleted_at` set to **the parent's exact timestamp**, and `set_updated_at`
-- bumps `updated_at` on each row as usual. So a peer observes ordinary row updates it already
-- knows how to replicate — it is told the children went, rather than being expected to infer it
-- from the parent (architecture §5).
--
-- The shared timestamp is also what keeps an undelete possible; see the restore half below.

create or replace function private.propagate_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  child_table constant text := tg_argv[0];
  fk_column constant text := tg_argv[1];
  mode constant text := tg_argv[2];
begin
  if mode = 'nullify' then
    -- mirrors `ON DELETE SET NULL`: removing a person must not remove the household's recipes,
    -- it must forget who wrote them
    execute format(
      'update public.%I set %I = null where %I = $1 and family_id = $2 and %I is not null',
      child_table, fk_column, fk_column, fk_column
    ) using old.id, new.family_id;
  else
    execute format(
      'update public.%I set deleted_at = $1 where %I = $2 and family_id = $3 and deleted_at is null',
      child_table, fk_column
    ) using new.deleted_at, old.id, new.family_id;
  end if;
  return null;
end;
$fn$;

comment on function private.propagate_soft_delete is
  'Tombstones (or nullifies) the children of a row that was just soft-deleted, using the parent''s exact timestamp. Attached by trigger to every parent carrying deleted_at — see assert_rls_invariants.';

/**
 * The reverse.
 *
 * Nothing in the product restores a soft-deleted row today: no screen offers it, no route sets
 * `deleted_at` back to null, and the only way to undo a deletion is a hand-written statement. This
 * exists so that the state after one is *defined* rather than discovered.
 *
 * Restoration is keyed on the shared timestamp: a child returns only if its `deleted_at` equals
 * the parent's, which means it went **because** the parent went. A rating deleted on its own
 * three weeks earlier stays deleted, which is the behaviour somebody restoring a recipe wants.
 * Timestamps are microsecond-precision, so two unrelated deletions colliding is not a case worth
 * defending against.
 *
 * `nullify` has no reverse — the old value is gone — so a restored member does not regain
 * authorship of the recipes they wrote. Stated rather than silently half-working.
 */
create or replace function private.restore_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  child_table constant text := tg_argv[0];
  fk_column constant text := tg_argv[1];
begin
  execute format(
    'update public.%I set deleted_at = null where %I = $1 and family_id = $2 and deleted_at = $3',
    child_table, fk_column
  ) using old.id, new.family_id, old.deleted_at;
  return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The map. Adding a child table is one row here.
-- ---------------------------------------------------------------------------

do $do$
declare
  entry record;
  propagation constant text[][] := array[
    -- parent, child, fk column, mode
    ['recipes', 'recipe_ingredients', 'recipe_id', 'tombstone'],
    ['recipes', 'recipe_steps', 'recipe_id', 'tombstone'],
    ['recipes', 'ratings', 'recipe_id', 'tombstone'],
    ['recipes', 'photos', 'recipe_id', 'tombstone'],
    ['recipes', 'shortlist_entries', 'recipe_id', 'tombstone'],
    ['recipes', 'plan_entries', 'recipe_id', 'tombstone'],
    ['meal_plans', 'plan_entries', 'meal_plan_id', 'tombstone'],
    -- a person who leaves takes their ratings with them: a score attributed to nobody is worse
    -- than no score, and the hard-delete cascade already says so
    ['family_members', 'ratings', 'family_member_id', 'tombstone'],
    -- but not the recipes they wrote. This mirrors ON DELETE SET NULL (created_by).
    ['family_members', 'recipes', 'created_by', 'nullify']
  ];
begin
  for entry in
    select propagation[i][1] as parent, propagation[i][2] as child,
           propagation[i][3] as fk, propagation[i][4] as mode
    from generate_subscripts(propagation, 1) as i
  loop
    execute format($t$
      create trigger %I
        after update of deleted_at on public.%I
        for each row
        when (old.deleted_at is null and new.deleted_at is not null)
        execute function private.propagate_soft_delete(%L, %L, %L)
    $t$, format('propagate_delete_to_%s_%s', entry.child, entry.fk), entry.parent,
         entry.child, entry.fk, entry.mode);

    if entry.mode = 'tombstone' then
      execute format($t$
        create trigger %I
          after update of deleted_at on public.%I
          for each row
          when (old.deleted_at is not null and new.deleted_at is null)
          execute function private.restore_soft_delete(%L, %L)
      $t$, format('restore_delete_to_%s_%s', entry.child, entry.fk), entry.parent,
           entry.child, entry.fk);
    end if;
  end loop;
end;
$do$;

-- ---------------------------------------------------------------------------
-- The rule, asserted, so the next child table cannot forget it.
-- ---------------------------------------------------------------------------

create or replace function private.assert_soft_delete_propagation()
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  unhandled text[];
begin
  /*
   * Every reference from a table carrying `deleted_at` to another table carrying `deleted_at`
   * needs a propagation trigger — or an entry in the exception list below with a reason.
   *
   * `families` and `accounts` are the exceptions, and both for the same reason: deleting one is
   * teardown, not editing. A household going away is a device wipe (decisions §20) and a hard
   * delete that cascades, not a million tombstones for a household that no longer exists.
   */
  select coalesce(array_agg(distinct signature order by signature), '{}')
  into unhandled
  from (
    select child.relname || '.' || ca.attname || ' -> ' || parent.relname as signature,
           child.relname as child_name,
           ca.attname as fk_column,
           parent.relname as parent_name
    from pg_constraint fk
    join pg_class child on child.oid = fk.conrelid
    join pg_class parent on parent.oid = fk.confrelid
    join pg_namespace n on n.oid = child.relnamespace and n.nspname = 'public'
    -- our schema only: `accounts.id` references `auth.users`, which carries a deleted_at of its
    -- own and is Supabase's to cascade, not ours
    join pg_namespace pn on pn.oid = parent.relnamespace and pn.nspname = 'public'
    join unnest(fk.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute ca on ca.attrelid = child.oid and ca.attnum = k.attnum
    where fk.contype = 'f'
      and ca.attname <> 'family_id'
      and parent.relname not in ('families', 'accounts')
      and exists (
        select 1 from pg_attribute d
        where d.attrelid = child.oid and d.attname = 'deleted_at' and d.attnum > 0
      )
      and exists (
        select 1 from pg_attribute d
        where d.attrelid = parent.oid and d.attname = 'deleted_at' and d.attnum > 0
      )
  ) as child_links
  where not exists (
    select 1
    from pg_trigger t
    join pg_class parent_table on parent_table.oid = t.tgrelid
    where parent_table.relname = child_links.parent_name
      and not t.tgisinternal
      and pg_get_triggerdef(t.oid) like '%propagate_soft_delete(''' || child_links.child_name || ''', ''' || child_links.fk_column || '''%'
  );

  if array_length(unhandled, 1) > 0 then
    raise exception
      'a soft delete would leave these children live, because ON DELETE CASCADE does not fire on an UPDATE: %',
      array_to_string(unhandled, ', ');
  end if;
end;
$fn$;

/*
 * Folded into the invariant every migration already calls, so it runs on every future migration
 * rather than only on this one. A trigger is invisible to somebody reading the delete route, and
 * this is what stops that invisibility becoming a gap.
 *
 * The existing body is *renamed* rather than restated. It is roughly two hundred lines and has
 * been copied forward verbatim by five migrations already; a sixth copy is a sixth chance for the
 * copies to drift apart. `pg_get_functiondef` returns the definition as it currently stands —
 * whatever the last migration to touch it left — and renaming it keeps one body in existence.
 *
 * **Where to read it:** `private.assert_household_invariants` is the household checks, last
 * written out in 20260811091600. `private.assert_rls_invariants` is now just the two calls below,
 * and remains the name every migration calls.
 */
do $do$
declare
  definition text;
begin
  definition := pg_get_functiondef('private.assert_rls_invariants()'::regprocedure);
  definition := replace(definition, 'private.assert_rls_invariants', 'private.assert_household_invariants');
  execute definition;
end;
$do$;

comment on function private.assert_household_invariants is
  'The household-table invariants: reads never depend on billing, writes always do, updated_at is maintained, references carry family_id, clients cannot stamp sync timestamps or hard-delete, and no client write policy exists on a platform table. Body last written in 20260811091600.';

create or replace function private.assert_rls_invariants()
returns void
language plpgsql
set search_path = ''
as $fn$
begin
  perform private.assert_household_invariants();
  perform private.assert_soft_delete_propagation();
end;
$fn$;

comment on function private.assert_rls_invariants is
  'Every schema invariant, in one call. Call from every migration that adds a table.';

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
