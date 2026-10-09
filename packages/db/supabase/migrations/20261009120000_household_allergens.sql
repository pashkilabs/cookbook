-- ---------------------------------------------------------------------------
-- What this household avoids (§71).
--
-- A household setting beside `measurement_system` and `timezone`, and the
-- reasoning is the whole reason the hard part of §71's design went away.
--
-- "This household avoids peanuts" is a **dietary constraint, not health
-- information about a person**: nobody is identified, nothing is attributable,
-- and it is the same category as a household being vegetarian. So the
-- special-category health-data question dissolves rather than being managed —
-- no export bar, no policy clause, no member named on a screen.
--
-- And it matches the kitchen. You do not cook two dinners, so the exclusion was
-- always household-wide *in effect*. Per-member storage would have held
-- something far more sensitive to produce an identical answer, which is the test
-- worth keeping: **if the more sensitive shape yields the same output, it is not
-- a design choice, it is a liability.**
--
-- Dislikes stay per member in `member_preferences`. An allergen excludes for
-- everyone and needs no name to do its job; a dislike is personal, and "Ada is
-- the one who says no" is the sentence that makes a suggestion legible.
-- ---------------------------------------------------------------------------

/*
 * The nine, as a function rather than inline, so one place names them.
 *
 * These must stay in step with the `Allergen` union in `packages/core`, which SQL cannot import —
 * a two-sites problem, and the kind this codebase has paid for. `test/household-allergens.test.ts`
 * compares this list against `ALLERGENS` from core, so a value added on one side and not the
 * other fails a test rather than silently rejecting a legitimate setting.
 */
create or replace function private.known_allergens()
returns text[]
language sql
immutable
as $$
  select array[
    'peanut', 'tree-nut', 'milk', 'egg', 'fish', 'shellfish', 'soy', 'wheat', 'sesame'
  ]::text[]
$$;

alter table public.families
  add column avoided_allergens text[] not null default '{}'::text[]
    constraint families_avoided_allergens_are_known
      -- `<@` is containment: every element must be one of the nine. An empty array is the
      -- default and means "nothing avoided", which is what every household had before this.
      check (avoided_allergens <@ private.known_allergens());

comment on column public.families.avoided_allergens is
  'Allergens this household avoids. A dietary constraint and not health data: it identifies nobody, which is why it lives here rather than on family_members (§71). Duplicates are harmless — the matcher reads it as a set — so no constraint forbids them and the seam deduplicates on write.';

create or replace function private.assert_allergens_are_household_wide()
returns void
language plpgsql
as $$
begin
  -- the column has to exist and be checked, or an unknown value would reach the matcher and
  -- silently match nothing: a filter that quietly stops filtering is the worst shape here
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.families'::regclass
      and conname = 'families_avoided_allergens_are_known'
  ) then
    raise exception 'nothing validates families.avoided_allergens, so an unknown allergen would be stored and then match nothing — a filter that stops filtering without failing';
  end if;

  /*
   * And the decision itself, enforced: no per-member allergen column.
   *
   * §71 settled this by *removing* sensitive data rather than protecting it, so the way it goes
   * wrong is somebody later adding what looks like a helpful refinement. Collecting a child's
   * allergen to compute a household-wide exclusion is the liability this avoided, and the
   * assertion carries that argument so the next reader meets it before the column.
   */
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'family_members'
      and column_name in ('allergens', 'allergies', 'avoided_allergens', 'dietary_restrictions')
  ) then
    raise exception 'family_members has an allergen column — §71 put allergens on the household on purpose: you do not cook two dinners, so a per-member list holds special-category health data to produce an identical answer. That is a liability, not a refinement';
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
  perform private.assert_allergens_are_household_wide();
end;
$outer$;

-- a household setting is changed through the seam, like measurement_system and timezone, so
-- the client gets no grant: `families` is a platform table and app code may not write it
do $do$
declare
  grantee text;
begin
  perform private.assert_rls_invariants();

  for grantee in select unnest(array['authenticated', 'anon']) loop
    if has_column_privilege(grantee, 'public.families'::regclass, 'avoided_allergens', 'UPDATE') then
      raise exception 'a client can write % directly — it is a platform setting', grantee;
    end if;
  end loop;

  /*
   * The predicate is checked here; the *write* is attempted in the test.
   *
   * The first version of this block inserted a probe row and caught `check_violation`. It failed
   * on `owner_account_id` instead — a NOT NULL on a column this has nothing to do with — so the
   * probe would have been refused for the wrong reason. It errored loudly rather than passing
   * falsely, which is the right failure, but a `DO` block has no household to hang a row on and
   * a probe that cannot succeed has measured nothing.
   *
   * So: the constraint exists (above), and the predicate behind it rejects an unknown value
   * (here). `test/household-allergens.test.ts` attempts the write against a real household, which
   * is the only place the constraint can actually be exercised.
   */
  if array['peanut', 'unobtainium']::text[] <@ private.known_allergens() then
    raise exception 'private.known_allergens() admits a value that is not one of the nine, so the check it backs would let an unknown allergen through to match nothing';
  end if;

  if not (array['peanut', 'sesame']::text[] <@ private.known_allergens()) then
    raise exception 'private.known_allergens() rejects a legitimate allergen, so the check would refuse a setting a household is entitled to make';
  end if;

end;
$do$;
