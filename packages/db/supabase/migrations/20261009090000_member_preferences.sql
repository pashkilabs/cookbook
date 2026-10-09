-- ---------------------------------------------------------------------------
-- What each person has SAID they like and dislike (§71, piece 2).
--
-- The taste patterns already infer this from ratings, and already say "too few
-- to say anything yet" honestly. This is the other half: a person stating it
-- outright, which is what makes month one work.
--
-- 26 ratings across 7 recipes, and the `cooked it` control that would generate
-- more has been live for weeks on a screen nobody has opened. So the learned
-- signal will stay thin **regardless of what gets built**, and a plan that waits
-- for ratings is waiting on something that is not happening. Stated preferences
-- are the mechanism, not a stopgap.
--
-- ---------------------------------------------------------------------------
-- Stated beats inferred, and nothing blends
-- ---------------------------------------------------------------------------
--
--   EXCLUDED (allergy) → stated dislike → stated like → inferred
--
-- No step blends with another. A stated dislike overrides an inferred like, and
-- the inferred value is shown *beside* the stated one so a person can see what
-- the app concluded and disagree — the editable-classification pattern, because
-- an inference nobody can correct goes wrong permanently.
--
-- ---------------------------------------------------------------------------
-- No score column, and the database refuses one
-- ---------------------------------------------------------------------------
--
-- The spine of §71: **nothing on screen may be a number a person cannot verify
-- by looking.** Suggestions partition by reason and order within a reason by how
-- many members a recipe satisfies — a count, checkable against four people in
-- the room. §67 measured that one score mixing a certainty, a guess and a thin
-- statistic is unreadable, and §61 measured that no confidence signal exists to
-- build one on.
--
-- So a weight here would be the first step back to that score, and §71 records
-- that such a feature is a **reversal of the decision, not an addition to it**.
-- `assert_preferences_carry_no_score` makes the database say so: a `weight`,
-- `score`, `strength` or `rank` column fails the invariant, so adding one means
-- deliberately removing an assertion that explains why it is there. Same shape
-- as `pantry_items` refusing an expiry column (§69).
--
-- ---------------------------------------------------------------------------
-- Allergies are deliberately NOT here
-- ---------------------------------------------------------------------------
--
-- Piece 1's matcher is pure and stores nothing, so it needs no schema. Storing a
-- child's allergen is **special-category health data**, which is on the open
-- questions list in CLAUDE.md, and the rule there is to stop and say so rather
-- than guess. The bar is also wider than prompts: an allergen must not reach a
-- shared view, a public recipe page or an export, which wants the policy-level
-- enforcement blends have — and that is a decision, not a migration.
-- ---------------------------------------------------------------------------

create table public.member_preferences (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  family_member_id uuid not null,
  -- two values and no middle: "likes" and "dislikes" are what a person states. A scale
  -- would be the score this design refuses, arriving as data rather than as a column.
  stance text not null check (stance in ('like', 'dislike')),
  subject_kind text not null check (subject_kind in ('ingredient', 'cuisine', 'dish_form', 'course')),
  -- the catalog key for an ingredient, or the classification value. Trimmed and non-empty,
  -- because " " and "" would be two distinct subjects nobody meant to create
  subject text not null check (length(btrim(subject)) > 0),
  -- why they said it, in their words, optional. Never parsed — a free note that a person
  -- can read beside a suggestion is worth more than a field something tries to act on
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  /*
   * The composite key, because `assert_household_invariants` demands it: "references
   * between household tables must include family_id, or a child can claim a household its
   * parent is not in". `family_members_id_family_id` exists for exactly this.
   *
   * CASCADE on hard delete, mirrored by a tombstone propagation below: a preference
   * attributed to nobody is worse than no preference, the same reasoning `ratings` uses.
   */
  constraint member_preferences_member foreign key (family_member_id, family_id)
    references public.family_members (id, family_id) on delete cascade
);

/*
 * One live stance per person per subject — and `stance` is NOT in the key.
 *
 * That is what makes liking and disliking the same thing impossible rather than merely
 * discouraged: stating a like where a dislike stands is an update, not a second row, so
 * the contradiction cannot exist for a resolver to have to break.
 */
create unique index member_preferences_one_per_subject
  on public.member_preferences (family_member_id, subject_kind, subject)
  where deleted_at is null;

create index member_preferences_family_id on public.member_preferences (family_id)
  where deleted_at is null;
create index member_preferences_lookup
  on public.member_preferences (family_id, subject_kind, subject)
  where deleted_at is null;

comment on table public.member_preferences is
  'What a person has SAID about an ingredient, cuisine, dish form or course. Stated preferences beat inferred ones and never blend with them (§71). Carries no weight or score on purpose: suggestions order by a count of people, which a person can verify by looking.';
comment on column public.member_preferences.stance is
  'like or dislike. Two values and no scale — a scale would be the single score §67 measured as unreadable, arriving as data instead of as a column.';

alter table public.member_preferences enable row level security;

create policy member_preferences_select_in_household on public.member_preferences
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

create policy member_preferences_insert_in_household on public.member_preferences
  for insert to authenticated
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy member_preferences_update_in_household on public.member_preferences
  for update to authenticated
  using (family_id in (select private.current_family_ids()))
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

/*
 * Privileges, explicitly, in both directions.
 *
 * Hosted runs `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated`, so a
 * new table is born with full DML for anonymous clients there and with none locally. Every
 * migration is therefore written against the stricter environment, and a local green proves
 * nothing about the grant matrix — so this revokes first and grants by column.
 */
revoke all on public.member_preferences from anon, authenticated;
grant select, insert, update, delete on public.member_preferences to service_role;
grant select on public.member_preferences to authenticated;
grant insert (family_id, family_member_id, stance, subject_kind, subject, note)
  on public.member_preferences to authenticated;
-- not family_id or family_member_id: a client may change its mind, never reattribute a
-- statement to another person or another household (§26 — a policy decides which rows are
-- reachable, a grant decides what a row may assert)
grant update (stance, note, deleted_at) on public.member_preferences to authenticated;

create trigger set_updated_at before update on public.member_preferences
  for each row execute function private.set_updated_at();

/*
 * A person who leaves takes their stated preferences with them, as they take their ratings.
 * `ON DELETE CASCADE` does not fire on a soft delete, so the FK above is not enough and
 * `assert_soft_delete_propagation` refuses the migration without this.
 */
create trigger propagate_delete_to_member_preferences_family_member_id
  after update of deleted_at on public.family_members
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete(
    'member_preferences', 'family_member_id', 'tombstone');

create trigger restore_delete_to_member_preferences_family_member_id
  after update of deleted_at on public.family_members
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.restore_soft_delete(
    'member_preferences', 'family_member_id');

create or replace function private.assert_preferences_carry_no_score()
returns void
language plpgsql
as $$
begin
  /*
   * The count-of-people rule, enforced rather than remembered.
   *
   * §67 measured that a single score mixing a certainty, a guess and a thin statistic produces
   * a number nobody can read, and §61 measured that no confidence signal is available to build
   * one on. §71 therefore records that a scored preference is a REVERSAL of this design.
   *
   * A reversal should cost a deliberate act, so it costs removing this. Same shape as
   * `pantry_items` refusing an expiry column: the assertion carries the argument, so the next
   * reader meets the reasoning before the column.
   */
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'member_preferences'
      and column_name in ('weight', 'score', 'strength', 'rank', 'confidence', 'priority')
  ) then
    raise exception
      'member_preferences has a weighting column — §71 decided against one: suggestions order by a COUNT of people, which somebody can verify by looking, and a weighted score is the unreadable number §67 measured. Adding one is a reversal of that decision, not an addition to it';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.member_preferences'::regclass
      and conname = 'member_preferences_stance_check'
  ) then
    raise exception 'member_preferences.stance has lost its two-value check — a scale would be the refused score arriving as data instead of as a column';
  end if;

  -- liking and disliking one subject must be impossible, not merely discouraged
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'member_preferences'
      and indexname = 'member_preferences_one_per_subject'
  ) then
    raise exception 'member_preferences can hold a like and a dislike for one subject, so a resolver would have to break a contradiction that should not exist';
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
  perform private.assert_preferences_carry_no_score();
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;

/*
 * The grant matrix, asserted here because `check:parity` compares environments and these two
 * disagree about what "default" means. A local green is not evidence.
 */
do $do$
declare
  leaked text;
begin
  select string_agg(format('%s:%s', grantee, privilege_type), ', ')
    into leaked
  from information_schema.role_column_grants
  where table_schema = 'public' and table_name = 'member_preferences'
    and grantee = 'anon';
  if leaked is not null then
    raise exception 'anon can reach member_preferences (%) — a household''s stated preferences are personal data and no public read path exists for them', leaked;
  end if;

  if exists (
    select 1 from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'member_preferences'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
      and column_name in ('family_id', 'family_member_id')
  ) then
    raise exception 'authenticated can rewrite member_preferences.family_id or family_member_id — a client may change its mind, never reattribute a statement to another person';
  end if;
end;
$do$;
