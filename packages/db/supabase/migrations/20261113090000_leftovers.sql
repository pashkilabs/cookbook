/*
 * ---------------------------------------------------------------------------
 * Leftovers: a meal that was already cooked, eaten on another day
 * ---------------------------------------------------------------------------
 *
 * **First, the word.** `docs/decisions.md` §78 lists "leftovers" under *deliberately elsewhere*:
 *
 *     Leftovers on the week's day meta line ("makes Mon lunch"). The shopping list owns
 *     leftovers because only it knows package sizes, so only it knows what is actually spare.
 *
 * That decision is about **ingredient** leftovers — `significantLeftovers()` filters shopping
 * lines by `line.leftover`, the spare quantity left after a package is chosen, and
 * `recipesUsingLeftovers` suggests what would finish the cream. It is a fact about package
 * arithmetic and it is still true.
 *
 * This is **meal** leftovers: Tuesday's dinner eaten on Thursday. Same word, different question,
 * and §78's reason does not transfer — the shopping list knows what is spare *in the cupboard*
 * and nothing in the app knows what is spare *in the fridge*. Recorded here rather than only in
 * the decision log because this column is where the next person will arrive, and §78's own rule
 * is to put the reason where they will look.
 *
 * ---------------------------------------------------------------------------
 * A leftover is a plan entry whose source is another plan entry
 * ---------------------------------------------------------------------------
 *
 * Not a table, not a flag on the original. The test is the one that made `shopping_groups` a
 * table and `section` a column: **does it have an identity outside the thing it belongs to?** A
 * shopping group does — it is named, reused across weeks, and survives the items in it. A
 * leftover does not: it is Tuesday's dinner, on Thursday. It has no name, no second use, and
 * nothing to say once its parent is gone.
 *
 * So it is the same row shape as a cook, with a pointer: its own `date` and `slot`, the recipe
 * reached through its parent, `family_id` like everything else.
 *
 * `recipe_id` **stays NOT NULL**, which the column's own comment anticipated:
 *
 *     required: an entry is a planned recipe. Free-text entries ("leftovers") would
 *     need this nullable, and that is a planner feature nobody has asked for yet.
 *
 * That comment imagined leftovers as a free-text row and correctly deferred the migration it
 * would need. Pointing at the parent instead means the recipe is still known — which is what
 * lets Thursday's row say *what* is being reheated, and lets a rating roll up to the recipe.
 */

-- ---------------------------------------------------------------------------
-- The composite key a household reference needs
-- ---------------------------------------------------------------------------
--
-- `assert_household_invariants` demands that a reference between household tables carry
-- `family_id`, or a child can claim a household its parent is not in. `recipes`, `meal_plans`,
-- `family_members` and `shopping_groups` each carry `unique (id, family_id)` for exactly this;
-- `plan_entries` had no reason to until it referenced itself.
alter table public.plan_entries
  add constraint plan_entries_id_family_id unique (id, family_id);

alter table public.plan_entries
  add column leftover_of uuid;

alter table public.plan_entries
  add constraint plan_entries_leftover_of
    foreign key (leftover_of, family_id)
    references public.plan_entries (id, family_id)
    on delete cascade;

-- a row cannot be its own leftover; the chain case is refused by the trigger below
alter table public.plan_entries
  add constraint plan_entries_leftover_not_self check (leftover_of is null or leftover_of <> id);

create index plan_entries_leftover_of_idx
  on public.plan_entries (leftover_of)
  where leftover_of is not null;

-- One leftover of one meal per slot. A double tap is not two meals.
--
-- The ordinary duplicate case — the same recipe twice on one day — is deliberately *allowed* and
-- answered by the route with a 409 offering to feed more people instead (§41). That offer is
-- about scaling and a leftover has no quantity to scale, so the question it asks cannot be
-- answered here; refusing the row outright is the honest equivalent. Lunch and dinner on the same
-- day stay possible, because `slot` is in the key.
create unique index plan_entries_one_leftover_per_slot
  on public.plan_entries (leftover_of, "date", slot)
  where leftover_of is not null and deleted_at is null;

comment on column public.plan_entries.leftover_of is
  'The cooked meal this is a leftover of. NULL for an ordinary planned cook. A leftover contributes nothing to the shopping list and does not count towards recipes.times_made — it was cooked once.';

-- ---------------------------------------------------------------------------
-- No chains: a leftover of a leftover is still from the original cook
-- ---------------------------------------------------------------------------
--
-- A check constraint cannot ask about another row, so this is a trigger. It is worth refusing
-- rather than tolerating: a chain is the first step towards a portions model — "half the
-- leftovers on Thursday, the rest on Friday" — which is deliberately out of scope, and allowing
-- the shape invites it without anybody deciding to.
--
-- Everything that has to be true of a leftover is tested with `leftover_of is not null`, so a
-- chain would not break the shopping exclusion or the count. It would break the *answer* to
-- "which meal did this come from", turning a pointer into a walk.
create or replace function private.refuse_leftover_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.leftover_of is not null
     and exists (
       select 1 from public.plan_entries parent
       where parent.id = new.leftover_of
         and parent.leftover_of is not null
     )
  then
    raise exception 'a leftover points at the meal that was cooked, not at another leftover'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function private.refuse_leftover_chain is
  'A leftover points at a cook, never at another leftover. A chain is the first step towards a portions model, which is out of scope.';

create trigger refuse_leftover_chain_on_plan_entries
  before insert or update of leftover_of on public.plan_entries
  for each row execute function private.refuse_leftover_chain();

-- ---------------------------------------------------------------------------
-- Insert only. A leftover's parent is not re-pointable
-- ---------------------------------------------------------------------------
--
-- The same reasoning as `family_id` and `family_member_id` carrying an INSERT grant and
-- deliberately no UPDATE one (§26): a client must not be able to move a row to a different
-- parent. Moving a leftover's *day* or *slot* is the feature and those grants already exist;
-- re-pointing it at a different cook is not a product action anybody has asked for, and a column
-- a client cannot write is a question that cannot be answered wrongly.
--
-- Consequence, stated because it is a real one: `.upsert()` on `plan_entries` with `leftover_of`
-- in the payload is impossible, for the reason §89 records — PostgREST renders a
-- merge-duplicates upsert as `DO UPDATE SET` every column in the payload. Ensure the row, then
-- set what you may.
grant insert (leftover_of) on public.plan_entries to authenticated;

-- ---------------------------------------------------------------------------
-- A leftover was cooked once, so it is not a second making
-- ---------------------------------------------------------------------------
--
-- `recipes.times_made` is a cache of `count(cooked plan entries)`, recomputed by trigger rather
-- than incremented — the asymmetry that function records is that a count is derivable from
-- events and events are not derivable from a count. So the exclusion belongs **here**, in the
-- derivation, and not in a route: there is no path that can forget it, including the ones the
-- function's own comment names (marking, unmarking, soft-deleting, restoring, moving).
--
-- Marking a leftover as cooked is still meaningful — it records that the meal was eaten — it
-- simply is not a second making of the recipe.
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
      and e.leftover_of is null
  )
  where r.id = touched;

  if old.recipe_id is not null and old.recipe_id <> touched then
    update public.recipes r
    set times_made = (
      select count(*)
      from public.plan_entries e
      where e.recipe_id = old.recipe_id
        and e.cooked_at is not null
        and e.deleted_at is null
        and e.leftover_of is null
    )
    where r.id = old.recipe_id;
  end if;

  return null;
end;
$$;

comment on function private.recount_times_made is
  'recipes.times_made is a cache of how many plan entries were COOKED, excluding leftovers — a leftover was cooked once, on its parent''s day. Recomputed rather than incremented, because marking, unmarking, soft-deleting, restoring and moving are five paths and arithmetic forgets one.';

-- the trigger already fires on leftover_of being written, because it fires on insert
drop trigger if exists recount_times_made_on_cooked on public.plan_entries;
create trigger recount_times_made_on_cooked
  after insert or delete or update of cooked_at, deleted_at, recipe_id, leftover_of
  on public.plan_entries
  for each row execute function private.recount_times_made();

-- ---------------------------------------------------------------------------
-- Deleting the cook takes its leftovers with it — and deletion here is an UPDATE
-- ---------------------------------------------------------------------------
--
-- The FK above carries `ON DELETE CASCADE`, and that fires on a **hard** delete, which is what a
-- household going away does. Every deletion a person performs is a soft one: clients hold no
-- DELETE and `deleted_at` is set instead, so the cascade never runs and a tombstoned cook would
-- keep a live leftover pointing at it — the exact shape of the recipe that kept its plan entries
-- and went on buying ingredients.
--
-- `private.propagate_soft_delete` is the house answer and `assert_soft_delete_propagation`
-- demands it for every household reference. Children take the parent's **exact** timestamp,
-- which is what makes "the cook was deleted" distinguishable from "this leftover was deleted on
-- its own" — and the latter is a real action: eating it on Thursday can be cancelled without
-- unmaking Tuesday's dinner.
-- `tombstone`, not `nullify`: a leftover with no parent is not a meal, it is a row that has
-- forgotten what it was. `nullify` is for a reference whose child survives the loss — a blend
-- outliving the recipe it was derived from — and this child does not.
create trigger propagate_delete_to_plan_entries_leftover_of
  after update of deleted_at on public.plan_entries
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete(
    'plan_entries', 'leftover_of', 'tombstone');

create trigger restore_delete_to_plan_entries_leftover_of
  after update of deleted_at on public.plan_entries
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.restore_soft_delete(
    'plan_entries', 'leftover_of');

-- ---------------------------------------------------------------------------
-- Assert the state afterwards, because a no-op looks like a success
-- ---------------------------------------------------------------------------
--
-- Hosted grants `ALL` on a new table to `anon` and `authenticated` by default and the local image
-- grants none, so a migration is written against a stricter environment than production. A column
-- grant is narrower than that hazard but the habit is the same: assert the matrix rather than
-- assume the statement above produced it.
do $$
declare
  can_update boolean;
  can_insert boolean;
begin
  select has_column_privilege('authenticated', 'public.plan_entries', 'leftover_of', 'INSERT')
    into can_insert;
  select has_column_privilege('authenticated', 'public.plan_entries', 'leftover_of', 'UPDATE')
    into can_update;

  if not can_insert then
    raise exception 'authenticated cannot insert plan_entries.leftover_of, so no client can log a leftover';
  end if;
  if can_update then
    raise exception 'authenticated can UPDATE plan_entries.leftover_of — a leftover must not be re-pointed at another cook';
  end if;
end;
$$;

-- The *behaviour* is asserted in `packages/db/test/leftovers.test.ts` rather than here, and the
-- reason is worth recording: `families.owner_account_id` is NOT NULL, so a probe needs an
-- `auth.users` row, and manufacturing one inside a migration is a fixture pretending to be a
-- schema statement. The suite builds households as a real client and can be mutation-tested,
-- which a `DO` block cannot.

select private.assert_household_invariants();
select private.assert_rls_invariants();
select private.assert_soft_delete_propagation();
select private.assert_times_made_is_derived();
select private.assert_no_family_propagation_triggers();
