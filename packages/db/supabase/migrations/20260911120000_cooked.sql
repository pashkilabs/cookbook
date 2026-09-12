-- ---------------------------------------------------------------------------
-- A meal that was actually cooked — an event, not a counter.
--
-- `plan_entries.cooked_at` has existed since the first app-tables migration and
-- has never been written. `recipes.times_made` is displayed in four places —
-- "made 3×", "untried", a filter, and a blend's "Nobody has cooked this" — and
-- was incremented nowhere. So every recipe read "untried" forever, the Untried
-- filter matched everything, and §60's graduation rule ("it becomes an ordinary
-- recipe when the household marks it cooked") described a mechanism that did not
-- exist. Twenty-eight meals were planned in production and none was ever recorded
-- as eaten.
--
-- ---------------------------------------------------------------------------
-- Why the event is the truth and the count is derived
-- ---------------------------------------------------------------------------
--
-- A counter cannot answer the questions a household actually asks. "Made 11×"
-- does not say *when*, and "we had that last week" is the whole reason anybody
-- looks. An event carries the date, the servings it was scaled to, and the slot —
-- a record of a meal rather than a tally against a recipe.
--
-- The asymmetry settles it: **a count is derivable from events and events are not
-- derivable from a count.** So `times_made` stays, because four screens read it,
-- but it becomes a cache of `count(cooked plan entries)` maintained here, and the
-- client loses the right to write it. A number a client could set is a number that
-- can disagree with the meals behind it.
--
-- It also changes what the planner is. A past week can show what a household *ate*
-- rather than what it *intended*, and "planned but never cooked" becomes visible —
-- which is information about the plan, not an absence.
--
-- ---------------------------------------------------------------------------
-- Recomputed, not incremented
-- ---------------------------------------------------------------------------
--
-- The trigger counts from scratch rather than adding one. Marking, unmarking,
-- soft-deleting a cooked entry, restoring it, and moving it between weeks are five
-- paths that would each need their own arithmetic, and `ON DELETE CASCADE does not
-- fire on a soft delete` is exactly the kind of path a +1/-1 scheme forgets. A
-- recount over one recipe's entries is a handful of rows and is right by
-- construction.
-- ---------------------------------------------------------------------------

create or replace function private.recount_times_made()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched uuid;
begin
  touched := coalesce(new.recipe_id, old.recipe_id);

  update public.recipes r
  set times_made = (
    select count(*)
    from public.plan_entries e
    where e.recipe_id = touched
      and e.cooked_at is not null
      and e.deleted_at is null
  )
  where r.id = touched;

  -- a moved entry changes two recipes only if the recipe itself changed, which the
  -- planner does not allow; recounting the old one as well costs nothing and is
  -- correct if that ever becomes possible
  if old.recipe_id is not null and old.recipe_id <> touched then
    update public.recipes r
    set times_made = (
      select count(*)
      from public.plan_entries e
      where e.recipe_id = old.recipe_id
        and e.cooked_at is not null
        and e.deleted_at is null
    )
    where r.id = old.recipe_id;
  end if;

  return null;
end;
$$;

comment on function private.recount_times_made is
  'recipes.times_made is a cache of how many plan entries were cooked. Recomputed rather than incremented, because marking, unmarking, soft-deleting, restoring and moving are five paths and arithmetic forgets one.';

create trigger recount_times_made_on_cooked
  after insert or delete or update of cooked_at, deleted_at, recipe_id on public.plan_entries
  for each row execute function private.recount_times_made();

-- ---------------------------------------------------------------------------
-- The client records the meal; the database keeps the count.
-- ---------------------------------------------------------------------------

grant update (cooked_at) on public.plan_entries to authenticated;

-- derived now, so a client writing it could make the number disagree with the meals
-- behind it — which is the whole reason the count was untrustworthy before
revoke insert (times_made), update (times_made) on public.recipes from authenticated;

/*
 * Existing values are recomputed, including down to zero.
 *
 * Two production recipes carry a `times_made` with no cooked entry behind it, from before the
 * column meant anything. Left alone they would be a number nothing can explain — the column now
 * means "meals recorded" and an unbacked 2 makes it mean two things at once. Recomputing loses
 * nothing that was ever recorded, because nothing ever was.
 */
update public.recipes r
set times_made = (
  select count(*)
  from public.plan_entries e
  where e.recipe_id = r.id and e.cooked_at is not null and e.deleted_at is null
);

create or replace function private.assert_times_made_is_derived()
returns void
language plpgsql
as $$
begin
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'times_made', 'UPDATE')
     or has_column_privilege('authenticated', 'public.recipes'::regclass, 'times_made', 'INSERT') then
    raise exception
      'a client can write times_made — it is derived from cooked plan entries and a writable copy can disagree with them';
  end if;

  if not has_column_privilege('authenticated', 'public.plan_entries'::regclass, 'cooked_at', 'UPDATE') then
    raise exception 'a household cannot record that it cooked a meal';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.plan_entries'::regclass
      and tgname = 'recount_times_made_on_cooked'
  ) then
    raise exception 'nothing maintains times_made — it would go stale silently, which is how it read "untried" forever';
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
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
