-- ---------------------------------------------------------------------------
-- A year, not an age.
--
-- An age is stale within twelve months and needs somebody to remember to correct
-- it; a year of birth is a fact and stays one. The age is computed at read time,
-- which is the only version that is never wrong.
--
-- ---------------------------------------------------------------------------
-- It does not replace is_child
-- ---------------------------------------------------------------------------
--
-- `is_child` stays the flag the kid-friendly filter reads. Whether a fourteen-year
-- -old counts as a child for taste purposes is a household's judgement, not a
-- threshold anybody should encode here — and a birthday must not silently change
-- what a filter returns. Year of birth is display, and a filter dimension later if
-- someone asks for one.
--
-- ---------------------------------------------------------------------------
-- It is a child's personal data
-- ---------------------------------------------------------------------------
--
-- Nullable, because it is optional and an unanswered question must stay
-- unanswered rather than becoming a guess. It **must never reach a prompt** —
-- CLAUDE.md already says prompts carry recipe content only, and
-- `assert_birth_year_stays_in_platform` below makes that specific rather than
-- general. It is removed with the household on account deletion, which
-- `family_members`' cascade already guarantees and which is asserted here so the
-- guarantee is not incidental.
--
-- **For the privacy policy, before outside families arrive:** this is the first
-- column in the schema that is a child's personal data rather than a household's
-- record of a preference. Whatever notice and consent that requires is not a
-- database question and is not settled by this migration.
-- ---------------------------------------------------------------------------

alter table public.family_members
  add column birth_year integer
    -- a range rather than a free integer: 1900 catches a typo'd 190, and the upper
    -- bound is checked against the row's own creation rather than a frozen literal
    check (birth_year is null or (birth_year >= 1900 and birth_year <= 2200));

comment on column public.family_members.birth_year is
  'Optional year of birth. The age is computed at read time — an age stored is stale within a year. Display only: is_child remains the flag any filter reads. A child''s personal data: never in a prompt, removed with the household.';

grant insert (birth_year), update (birth_year) on public.family_members to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions, so the three promises above are checkable rather than stated.
-- ---------------------------------------------------------------------------

create or replace function private.assert_birth_year_stays_in_platform()
returns void
language plpgsql
as $$
begin
  -- anon must not read it at all: it is a child's personal data on a platform table
  if has_column_privilege('anon', 'public.family_members'::regclass, 'birth_year', 'SELECT') then
    raise exception 'anon can read a child''s year of birth';
  end if;

  -- and it must go with the household. family_members cascades from families; if that
  -- ever changes, a deleted account leaves a child's birth year behind
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.family_members'::regclass
      and contype = 'f'
      and confrelid = 'public.families'::regclass
      and confdeltype = 'c'
  ) then
    raise exception
      'family_members no longer cascades from families — deleting an account would leave a child''s year of birth behind';
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
end;
$outer$;

do $do$
begin
  perform private.assert_rls_invariants();

  if not has_column_privilege('authenticated', 'public.family_members'::regclass, 'birth_year', 'UPDATE') then
    raise exception 'a household cannot record or correct a year of birth';
  end if;
end;
$do$;
