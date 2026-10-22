-- ---------------------------------------------------------------------------
-- How *each person* decides what to cook (§87) — the layout moves to the member.
--
-- §85 put `recipe_layout` on `families` because the question read as a household
-- one. It is not. §71's test is whether the more specific shape produces a
-- different answer: an allergen excludes for everyone because **you do not cook
-- two dinners**, so storing it per person would hold something more sensitive to
-- compute an identical result. A layout is the other side of that test. Paige
-- looking for a recipe does not constrain how Stephen looks for one, and two
-- people browsing differently costs nothing — so the household shape was forcing
-- a compromise that bought nothing.
--
-- It was found the expensive way. Stephen chose `browse`; Paige, invited months
-- ago and the household's main user, went on seeing the column default. That
-- turned out to be a resolver bug rather than the schema (an invited member read
-- five of nine columns), but fixing the read only made them agree — and agreeing
-- was never what was wanted.
--
-- ---------------------------------------------------------------------------
-- Why a new app table rather than the two obvious homes
-- ---------------------------------------------------------------------------
--
-- `member_preferences` is already per-member and already outside the seam, and
-- it is the wrong home: `stance` is ('like','dislike') and `subject_kind` is
-- ('ingredient','cuisine','dish_form','course'). A layout is neither a stance
-- nor a subject, so putting it there means widening both CHECKs — and those
-- CHECKs are what that table *is*. Its own migration argues it must not become a
-- key-value store, and `assert_preferences_carry_no_score` enforces that it
-- cannot grow a weight. A layout arriving as a fifth `subject_kind` is the same
-- erosion wearing a different word.
--
-- `family_members` is per-member too, and it is a **platform** table. The layout
-- vocabulary is `private.known_recipe_layouts()` — 'rotation', 'browse',
-- 'time', 'protein', 'decide' — which is tenant #1's language, not a platform's.
-- The seam exists so extracting a platform for app #2 is mechanical, and a
-- platform carrying one app's screen vocabulary is precisely the coupling it was
-- built to prevent. `colour` sits there legitimately because a colour means the
-- same thing to any app; 'protein' does not.
--
-- So: an app table, with `family_id`, under RLS, readable and writable by the
-- client that owns the row. The vocabulary stays where its CHECK already lives.
--
-- **Explicit columns, never a blob.** This is the junk-drawer risk and it is
-- named rather than hoped away: a `settings jsonb` here would be a place to put
-- anything, and the next thing put there would arrive without a CHECK. Every
-- setting on this table gets a column and a constraint, or it does not go here.
-- ---------------------------------------------------------------------------

create table public.member_settings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  family_member_id uuid not null,

  /*
   * What this person's /recipes renders. NOT NULL with a default, so there is no
   * absent state to default in application code — the fault §87 is named for was
   * a `?? 'rotation'` dressing an unread column as a choice.
   */
  recipe_layout text not null default 'rotation'
    constraint member_settings_recipe_layout_is_known
      check (recipe_layout = any (private.known_recipe_layouts())),

  /*
   * Null means this person has never been asked, and only null prompts.
   *
   * Per person on purpose: "not now" is an answer *somebody* gave, and Paige
   * being asked once is not satisfied by Stephen having answered. A dismissal
   * stamps this and leaves `recipe_layout` alone, exactly as the household
   * version did.
   */
  recipe_layout_asked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  /*
   * Composite, because `assert_household_invariants` demands it: a reference
   * between household tables carries family_id or a child can claim a household
   * its parent is not in.
   */
  constraint member_settings_member foreign key (family_member_id, family_id)
    references public.family_members (id, family_id) on delete cascade,

  /* one row per member — the settings are columns on it, not rows under it */
  constraint member_settings_one_per_member unique (family_member_id, family_id)
);

create index member_settings_household on public.member_settings (family_id)
  where deleted_at is null;

comment on table public.member_settings is
  'Per-person app settings, as explicit CHECKed columns and never a blob. Lives here rather than on family_members because the vocabulary is this app''s, and rather than in member_preferences because a layout is not a stance about food (§87).';

alter table public.member_settings enable row level security;

/*
 * A person reads and writes their household's rows.
 *
 * Scoped to the household rather than to the one member, deliberately: the
 * screens that show "how everyone browses" do not exist yet, and a policy that
 * admits them costs nothing a household-wide allergen list does not already
 * admit. What it must not admit is another household, which `current_family_ids`
 * settles.
 */
create policy member_settings_select_in_household on public.member_settings
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

/*
 * Writes depend on the entitlement; reads never do. `assert_household_invariants`
 * refused this migration until the check was here, which is the invariant doing
 * its job — a lapsed household must stop being able to change settings while
 * still being able to read its own kitchen.
 */
create policy member_settings_insert_in_household on public.member_settings
  for insert to authenticated
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy member_settings_update_in_household on public.member_settings
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
 * Columns, not tables (§26, decisions): a table-wide grant would let a client
 * stamp its own `updated_at` and rewrite `created_at`, which the sync model owns.
 */
revoke all on public.member_settings from anon, authenticated;
grant select on public.member_settings to authenticated;
grant insert (family_id, family_member_id, recipe_layout, recipe_layout_asked_at)
  on public.member_settings to authenticated;
grant update (recipe_layout, recipe_layout_asked_at)
  on public.member_settings to authenticated;
grant select, insert, update, delete on public.member_settings to service_role;

create trigger set_updated_at before update on public.member_settings
  for each row execute function private.set_updated_at();

create trigger propagate_delete_to_member_settings_family_id
  after update of deleted_at on public.families
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete(
    'member_settings', 'family_id', 'tombstone');

create trigger restore_delete_to_member_settings_family_id
  after update of deleted_at on public.families
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.propagate_soft_delete(
    'member_settings', 'family_id', 'restore');

/*
 * And the member, not only the household. `ON DELETE CASCADE` does not fire on a
 * soft delete — every deletion here is an UPDATE setting `deleted_at`, because
 * clients hold no DELETE — so the composite FK above is not enough and
 * `assert_soft_delete_propagation` refuses the migration without these. It did
 * refuse this one, which is the invariant earning its place rather than
 * decorating the file.
 */
create trigger propagate_delete_to_member_settings_family_member_id
  after update of deleted_at on public.family_members
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete(
    'member_settings', 'family_member_id', 'tombstone');

create trigger restore_delete_to_member_settings_family_member_id
  after update of deleted_at on public.family_members
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.restore_soft_delete(
    'member_settings', 'family_member_id');

-- ---------------------------------------------------------------------------
-- Carry the existing answer across rather than discarding it
-- ---------------------------------------------------------------------------
--
-- Whoever answered keeps their answer; everybody else starts unasked.
--
-- The honest limit, stated because the alternative is a silent guess: **nothing
-- recorded who set it.** `families.recipe_layout` has no author column, and
-- `updated_at` holds only the most recent write to the row. So "whoever set it"
-- is not answerable from the data, and the owner is the defensible stand-in —
-- they are the member whose read was correct throughout, so they are the only
-- one who could have seen what they were choosing. A member who answered and was
-- then shown the default by the resolver bug loses that answer here; that is a
-- real cost and it is smaller than attributing a choice to somebody at random.
--
-- Only households that were actually asked carry anything over. A household
-- still at the untouched default has nothing to migrate, and seeding its owner
-- with 'rotation' + a stamp would mean "asked and answered rotation", which is a
-- claim the data does not support — and it would suppress the prompt forever.
insert into public.member_settings (family_id, family_member_id, recipe_layout, recipe_layout_asked_at)
select f.id, m.id, f.recipe_layout, f.recipe_layout_asked_at
from public.families f
join public.family_members m
  on m.family_id = f.id
 and m.account_id = f.owner_account_id
 and m.deleted_at is null
where f.deleted_at is null
  and f.recipe_layout_asked_at is not null
on conflict (family_member_id, family_id) do nothing;

do $do$
declare
  carried integer;
begin
  select count(*) into carried from public.member_settings where recipe_layout_asked_at is not null;
  raise notice 'member_settings: carried % answered layout(s) to the owner', carried;
end;
$do$;

alter table public.families drop column recipe_layout;
alter table public.families drop column recipe_layout_asked_at;

/*
 * `assert_recipe_layout_is_a_household_setting` asserted the opposite and is
 * replaced rather than left behind: an invariant that still argues for the old
 * shape is worse than none, because the next reader believes it.
 */
drop function if exists private.assert_recipe_layout_is_a_household_setting();

create or replace function private.assert_recipe_layout_is_per_member()
returns void
language plpgsql
as $$
begin
  -- the columns must not come back on families: this is the assertion
  -- `assert_blends_never_public` is modelled on, and the reason is the same —
  -- a re-added column would make the household the authority again and every
  -- member would silently share one answer
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'families'
      and column_name in ('recipe_layout', 'recipe_layout_asked_at')
  ) then
    raise exception
      'families carries a recipe layout again — it is per member (§87), and a household column means one answer for everybody';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'member_settings'
      and column_name = 'recipe_layout'
  ) then
    raise exception 'member_settings.recipe_layout is missing — the layout has nowhere per-member to live';
  end if;

  -- the CHECK, or an unknown layout reaches the renderer and falls through to a
  -- default, which is the shape §87 exists for
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_settings_recipe_layout_is_known'
  ) then
    raise exception 'member_settings.recipe_layout is unconstrained — an unknown layout would render as a default';
  end if;

  /*
   * `asked_at` must stay nullable. The household version asserted this too, and
   * the reason is sharper now: null is "this person has never been asked", so a
   * NOT NULL here would mean everybody reads as already asked and no new member
   * is ever prompted.
   */
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'member_settings'
      and column_name = 'recipe_layout_asked_at' and is_nullable = 'NO'
  ) then
    raise exception 'member_settings.recipe_layout_asked_at is NOT NULL, so every member reads as already asked and the prompt can never appear';
  end if;

  /* a client that could stamp its own timestamps owns the sync model (§26) */
  if has_column_privilege('authenticated', 'public.member_settings'::regclass, 'updated_at', 'UPDATE') then
    raise exception 'a client can write member_settings.updated_at directly';
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
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
