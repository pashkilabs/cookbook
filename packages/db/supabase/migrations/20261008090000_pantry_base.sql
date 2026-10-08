-- ---------------------------------------------------------------------------
-- A base in the freezer: a pantry item that remembers which part of which
-- recipe it is.
--
-- Three attempts failed at *matching* a base to other recipes (§64, §67, §68).
-- This is the version that needs no matching: **make extra now, cook faster
-- later**, where the only finish is the same recipe again. So the hard question
-- never arises.
--
-- ---------------------------------------------------------------------------
-- Why a column on pantry_items and not an object of its own
-- ---------------------------------------------------------------------------
--
-- A base behaves like a jar of sauce: it is in the house, it comes off the
-- shopping list, and it runs out. `pantry_items` already is that, and the
-- shopping list already deducts it. What it cannot do is say *which* part of a
-- recipe it is, and §64 measured why that matters: a pantry item is a name
-- somebody typed, and `consolidate` matches it by exact name, so "the Greek
-- dressing" matches nothing at all.
--
-- These two columns remove the matching problem rather than improving it. A base
-- created from a known recipe carries that recipe's id and its component's name,
-- so the lines it covers are *looked up*, never guessed: the dressing is lines
-- 0-9 of Greek Salad, and planning Greek Salad again skips exactly those.
--
-- ---------------------------------------------------------------------------
-- `amount` counts batches, and that is what replaces an expiry date
-- ---------------------------------------------------------------------------
--
-- No date column, deliberately. An enforced shelf life means guessing it per
-- food, and being wrong either discards good food or leaves a dead item
-- deducting from the shopping list — and **the list is the one output that costs
-- money when it is wrong**. The 31 pantry items a household has actually typed
-- carry no dates and nobody has asked for any.
--
-- The decrement is what makes that safe. Two batches, cook one, one remains, and
-- the list deducts one occurrence rather than two. Reaching zero *is* deletion
-- happening naturally, so only an **abandoned** base lingers — not a used one.
-- That path is what a date would otherwise have hidden, so it is tested directly
-- rather than assumed.
-- ---------------------------------------------------------------------------

alter table public.pantry_items
  add column from_recipe_id uuid,
  -- the component's name as it was when the base was made, not a pointer into a
  -- partition that gets recomputed. `components` is a derived cache keyed on the
  -- ingredient lines: re-reading a recipe can renumber or rename its parts, and a
  -- base pointing at index 2 of a partition that has changed is the stale-index
  -- failure the blend lineage already has keys for.
  add column from_component text
    check (from_component is null or length(from_component) between 1 and 120),
  /*
   * One direction, not an equality, and the soft-delete trigger is why.
   *
   * It was `(from_recipe_id is null) = (from_component is null)` until the propagation
   * below was added: `nullify` sets `from_recipe_id` to null and cannot touch a second
   * column, so tidying away a recipe would have left a row the CHECK refused and the
   * trigger would have failed outright.
   *
   * The looser rule is also the truer one. A recipe id with no component name cannot
   * have its lines looked up and is nonsense. A component name with no recipe is a
   * base whose recipe has gone — still in the freezer, still worth naming, and exactly
   * what the nullify was for.
   */
  add constraint pantry_items_base_names_its_part
    check (from_recipe_id is null or from_component is not null),
  /*
   * The composite key, because `assert_household_invariants` refused the plain one:
   * "references between household tables must include family_id, or a child can claim
   * a household its parent is not in". It was right — a pantry item pointing at
   * `recipes(id)` alone could name another household's recipe and have its lines
   * looked up. Same shape `recipe_derivations` uses for a blend's source.
   *
   * SET NULL rather than CASCADE, and the column list is mandatory: without it the
   * delete tries to null `family_id`, which is NOT NULL, and fails instead. A base
   * must survive its recipe being tidied away — it is still in the freezer — and it
   * becomes an ordinary named pantry item, which is what it looks like in there.
   */
  add constraint pantry_items_base_recipe
    foreign key (from_recipe_id, family_id)
    references public.recipes (id, family_id) on delete set null (from_recipe_id),
  add constraint pantry_items_base_counts_batches
    -- a base is counted, never measured: "2" means two batches, and a base with
    -- no amount could not be decremented, so it would deduct for ever
    check (from_recipe_id is null or (amount is not null and amount >= 0));

comment on column public.pantry_items.from_recipe_id is
  'When this pantry item is a BASE — a part of a recipe cooked ahead and kept — the recipe it came from. Null for an ordinary pantry item. Nulled rather than cascaded if the recipe goes: a base in the freezer outlives the recipe being tidied away.';
comment on column public.pantry_items.from_component is
  'The component''s name as it was when the base was made. A name and not an index: `components` is a derived cache keyed on the ingredient lines, so re-reading a recipe can renumber its parts.';

grant insert (from_recipe_id, from_component), update (from_recipe_id, from_component)
  on public.pantry_items to authenticated;

create index pantry_items_base on public.pantry_items (family_id, from_recipe_id)
  where deleted_at is null and from_recipe_id is not null;

/*
 * Soft-delete propagation: NULLIFY, not tombstone.
 *
 * `ON DELETE CASCADE` does not fire on an UPDATE setting `deleted_at`, so the FK above
 * is not enough and `assert_soft_delete_propagation` refuses the migration without this.
 *
 * Nullify because **a base outlives the recipe being tidied away** — it is still in the
 * freezer, and tombstoning it would quietly throw away food. It becomes an ordinary named
 * pantry item, which is what it looks like in there. Nullify has no restore, and that is
 * stated rather than half-built: an undeleted recipe does not reclaim its bases.
 */
create trigger propagate_delete_to_pantry_items_from_recipe_id
  after update of deleted_at on public.recipes
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete(
    'pantry_items', 'from_recipe_id', 'nullify');

create or replace function private.assert_pantry_base_is_countable()
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pantry_items'::regclass
      and conname = 'pantry_items_base_counts_batches'
  ) then
    raise exception
      'a base with no amount cannot be decremented, so it would deduct from the shopping list for ever — and there is no expiry date to stop it (§69)';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pantry_items'::regclass
      and conname = 'pantry_items_base_names_its_part'
  ) then
    raise exception 'a base could name a recipe without naming its part, so its lines could not be looked up';
  end if;

  -- a date would be the wrong fix for a lingering base; the decrement is the right one
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pantry_items'
      and column_name in ('expires_at', 'use_by', 'best_before')
  ) then
    raise exception
      'pantry_items has an expiry column — §69 decided against one: guessing shelf life per food either discards good food or leaves a dead item deducting from the list, and the decrement is what ends a base instead';
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
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
