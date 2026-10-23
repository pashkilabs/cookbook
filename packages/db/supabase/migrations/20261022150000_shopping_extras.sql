/*
 * ---------------------------------------------------------------------------
 * Things somebody added to the week's shopping, that no recipe asked for
 * ---------------------------------------------------------------------------
 *
 * Designed in `docs/shopping-additions.md` before any of this was written. The short version:
 * an added item becomes **one more `ConsolidationEntry`**, handed to the same `consolidate()`
 * every recipe goes through — so it merges with recipe lines by construction, unresolvable text
 * already has defined behaviour there, and the tick key is the same key.
 *
 * ---------------------------------------------------------------------------
 * `raw_text` only. The parse is NOT stored
 * ---------------------------------------------------------------------------
 *
 * `recipe_ingredients` stores `amount`, `unit` and `item_text`, so storing the parse is the house
 * convention — and it is the wrong convention here. A recipe's parse is stored because a **review
 * screen** confirmed it; a typed line has no review screen, and demanding one for "milk" is
 * absurd friction. A stored parse nobody confirmed is a cache with no version, which is the trap
 * this project has already paid for twice (`EXTRACTOR_VERSION` unturned, `promptKey` omitting the
 * prompt). `parseIngredientList` is pure and in core, so it runs on read.
 *
 * One source of truth, no stale answer to serve, and an improvement to the parser fixes every
 * existing row with no migration. The cost, stated: a parser change can alter what an existing
 * extra means, including its tick key.
 *
 * No `resolved_ingredient_id` either — resolution is a function of the catalog, which changes, and
 * freezing it in a row is the same cache.
 */

create table public.shopping_extras (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,

  /*
   * The week it belongs to, which is what makes clearing a non-problem.
   *
   * The shopping list *is* a week — `shopping_ticks` is already keyed
   * `(family_id, week_start, item_key)` for exactly this reason. So nothing has to expire an
   * extra: next week simply does not select it. **No reaper, no cron, no expiry job.**
   *
   * Standing items ("we always need milk") are deliberately **out of scope** and must not be
   * smuggled in behind this as a `standing boolean` — that would commit, by accident, answers to
   * three questions nobody has asked: does it return after you tick it, does it return if you
   * still have some, and how does it talk to the pantry, which already holds "what we have".
   */
  week_start date not null,

  /* exactly what was typed, trimmed only enough that " " cannot become a row */
  raw_text text not null check (length(btrim(raw_text)) > 0 and length(raw_text) <= 200),

  /*
   * Who added it. NOT NULL, unlike §88's `allergen_changes.changed_by`, because there is no
   * writer here without an actor: the only path is a route holding a session. A NOT NULL column
   * is a constraint rather than an assumption — it refuses an unattributed extra instead of
   * quietly accepting one, and a future importer has to answer the question rather than skip it.
   *
   * Composite, because `assert_household_invariants` demands that a reference between household
   * tables carry `family_id` or a child can claim a household its parent is not in.
   */
  added_by uuid not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint shopping_extras_member foreign key (added_by, family_id)
    references public.family_members (id, family_id) on delete cascade
);

/*
 * No unique constraint on the text.
 *
 * Two people both asking for milk is **two requests**, and the list should say so — that is the
 * whole value of `added_by` reaching `ShoppingLine.uses`. Deduplication is `consolidate`'s job
 * and it happens by catalog key at read time, where it also merges with the recipes.
 */
create index shopping_extras_week on public.shopping_extras (family_id, week_start)
  where deleted_at is null;

comment on table public.shopping_extras is
  'Things added to a week''s shopping list by hand, stored as the text that was typed and parsed on read (§89). Week-scoped, so nothing has to clear them. Standing items are deliberately not this table.';
comment on column public.shopping_extras.raw_text is
  'Exactly what was typed. The parse is NOT stored: a typed line has no review screen to confirm it, and a stored parse nobody confirmed is a cache with no version.';

alter table public.shopping_extras enable row level security;

create policy shopping_extras_select_in_household on public.shopping_extras
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

create policy shopping_extras_insert_in_household on public.shopping_extras
  for insert to authenticated
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy shopping_extras_update_in_household on public.shopping_extras
  for update to authenticated
  using (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  )
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

/*
 * Columns, not tables (§26). A table-wide grant would let a client stamp its own `created_at`,
 * rewrite `updated_at`, or reattribute somebody else's extra to itself.
 *
 * `deleted_at` is updatable because removing an extra is a soft delete — clients hold no DELETE.
 * `added_by` is insertable and NOT updatable: who asked for something is not editable after the
 * fact, which is the same reasoning the audit log takes one table along.
 */
revoke all on public.shopping_extras from anon, authenticated;
grant select on public.shopping_extras to authenticated;
grant insert (family_id, week_start, raw_text, added_by)
  on public.shopping_extras to authenticated;
grant update (raw_text, deleted_at)
  on public.shopping_extras to authenticated;
grant select, insert, update, delete on public.shopping_extras to service_role;

create trigger set_updated_at before update on public.shopping_extras
  for each row execute function private.set_updated_at();

/*
 * ---------------------------------------------------------------------------
 * Propagation from the MEMBER, and deliberately not from the household
 * ---------------------------------------------------------------------------
 *
 * `ON DELETE CASCADE` does not fire on a soft delete — every deletion here is an UPDATE setting
 * `deleted_at`, because clients hold no DELETE, so a cascade declared on a foreign key never runs
 * (§30). A removed member must take their extras with them, and children take the parent's
 * *exact* timestamp so an undelete is distinguishable from a child deleted on its own.
 *
 * **Nothing propagates from `families`, and the first version of this migration got that wrong.**
 * `assert_soft_delete_propagation` excludes `families` and `accounts` by name and says why:
 * *"deleting one is teardown, not editing. A household going away is a device wipe (§20) and a
 * hard delete that cascades, not a million tombstones for a household that no longer exists."*
 * The FK carries `ON DELETE CASCADE` for exactly that.
 *
 * The triggers added anyway did not merely do nothing — they **threw**, on every household
 * soft-delete, with no child rows involved: `private.propagate_soft_delete` reads
 * `new.family_id`, which exists on `family_members` and not on `families`. The cleanup below
 * removes the three sets that had accumulated, and the assertion refuses the next one.
 */
create trigger propagate_delete_to_shopping_extras_added_by
  after update of deleted_at on public.family_members
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete('shopping_extras', 'added_by', 'tombstone');

/*
 * `restore_soft_delete`, which is a **different function** taking two arguments and no mode.
 *
 * The first version passed `'restore'` as a third argument to `propagate_soft_delete`, which
 * accepts it and does nothing: its UPDATE carries `where deleted_at is null`, so on a restore it
 * matches only rows that are already live and never the tombstoned child it was meant to bring
 * back. A silent no-op, in a trigger whose name says restore — the tombstone half worked, so the
 * pair looked symmetric and was not.
 */
create trigger restore_delete_to_shopping_extras_added_by
  after update of deleted_at on public.family_members
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.restore_soft_delete('shopping_extras', 'added_by');

/*
 * ---------------------------------------------------------------------------
 * Remove the propagation triggers that cannot work on `families`
 * ---------------------------------------------------------------------------
 *
 * `cart_exports` had them first and `member_settings` copied the pattern, which is how a shape
 * that reads correct spreads. All six throw `record "new" has no field "family_id"` on any
 * household soft-delete, which is **worse than doing nothing**: an unsupported operation became
 * an erroring one, and the error names a field rather than the mistake.
 *
 * Found by writing a test for the propagation rather than by reading the trigger. It was green in
 * `check:parity` and in every invariant the whole time, because the invariant asks which
 * references *lack* a trigger and never asks whether a trigger it finds can run.
 */
drop trigger if exists propagate_delete_to_cart_exports_family_id on public.families;
drop trigger if exists restore_delete_to_cart_exports_family_id on public.families;
drop trigger if exists propagate_delete_to_member_settings_family_id on public.families;
drop trigger if exists restore_delete_to_member_settings_family_id on public.families;

/*
 * And refuse the next one, by name rather than by category.
 *
 * The narrowest condition that separates the legitimate case: `private.propagate_soft_delete`
 * specifically cannot be attached to `public.families`, because it reads `new.family_id`. A
 * families trigger doing something else entirely is none of this assertion's business.
 */
create or replace function private.assert_no_family_propagation_triggers()
returns void
language plpgsql
as $$
declare
  wrong text;
begin
  select string_agg(t.tgname, ', ' order by t.tgname)
  into wrong
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  where t.tgrelid = 'public.families'::regclass
    and not t.tgisinternal
    and p.proname = 'propagate_soft_delete';
  if wrong is not null then
    raise exception
      'propagate_soft_delete cannot run on families — it reads new.family_id, which families has no field for, so these throw on every household soft-delete: %. A household going away is a hard delete that cascades (§20).',
      wrong;
  end if;
end;
$$;

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
  perform private.assert_recipe_layout_is_per_member();
  perform private.assert_allergen_changes_are_logged_and_private();
  perform private.assert_no_family_propagation_triggers();
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
