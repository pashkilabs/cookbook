-- ---------------------------------------------------------------------------
-- The cross-household read surface, revoked until public recipe pages exist.
--
-- **Revoked pending the feature — not a decision against public pages.** §17's
-- design stands and the schema for it stays: `visibility`, `private.recipe_is_public`
-- and the column grants are all left exactly where they are, so restoring this is
-- one migration that re-creates three policies.
--
-- What is being removed is only the standing permission. The anon half of this was
-- already revoked in 20260814090000 for the same reason; these three are its
-- `authenticated` counterpart, and they let any signed-in account read any
-- household's published recipe, its ingredient lines and its camera photographs.
--
-- ---------------------------------------------------------------------------
-- Why now, when nothing has gone wrong
-- ---------------------------------------------------------------------------
--
-- Nothing renders a public recipe. The read path has been live on a public project
-- for a feature that does not exist, and "build it or revoke it" has been the
-- roadmap's own words for weeks. An unused public read path is fine until it is
-- not, and the moment it stops being fine is not one anybody gets told about.
--
-- It is also the cheapest possible thing to undo, which is the argument for doing
-- it rather than continuing to intend to.
--
-- ---------------------------------------------------------------------------
-- Asserted, so it cannot come back by accident
-- ---------------------------------------------------------------------------
--
-- `assert_public_reads_revoked` fails if any of the three returns. That is
-- deliberately in the way: **when the feature is built, this assertion has to be
-- replaced in the same migration that re-creates the policies**, which makes
-- restoring the surface a decision somebody writes down rather than a policy that
-- reappears in a diff.
--
-- Note what is NOT asserted: `recipes.visibility` may still be set to 'public'.
-- A household marking a recipe public is recording an intention, and nothing reads
-- it — taking that away would lose information for no gain.
-- ---------------------------------------------------------------------------

drop policy if exists recipes_select_public_any on public.recipes;
drop policy if exists recipe_ingredients_select_public_any on public.recipe_ingredients;
drop policy if exists photos_select_public_any on public.photos;

/*
 * `assert_blends_never_public` refused this migration, correctly, and that is worth recording.
 *
 * It required `recipes_select_public_any` to exist and to exclude blends — a reasonable rule
 * written when the policy was the only way a blend could reach a public reader. With the policy
 * gone the rule is satisfied more completely than it asks for: there is no public read path at
 * all. So the invariant becomes "no public read path, **or** one that excludes blends", and it
 * still fails the moment somebody re-creates the policy without `derived_at`.
 *
 * Restated in full rather than patched, because this is one function each migration replaces.
 */
create or replace function private.assert_blends_never_public()
returns void
language plpgsql
as $$
declare
  body text;
  policy_expression text;
begin
  body := pg_get_functiondef('private.recipe_is_public(uuid)'::regprocedure);
  if body not like '%derived_at is null%' then
    raise exception
      'recipe_is_public no longer excludes blends — a blend''s ingredients can reach a public read path (§60 step 4)';
  end if;

  select pg_get_expr(polqual, polrelid) into policy_expression
  from pg_policy
  where polrelid = 'public.recipes'::regclass and polname = 'recipes_select_public_any';

  -- absent is stronger than excluded: the surface is revoked (20260911090000)
  if policy_expression is not null and policy_expression not like '%derived_at%' then
    raise exception
      'recipes_select_public_any is back and no longer excludes blends (§60 step 4)';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.recipes'::regclass
      and conname = 'recipes_blends_are_never_public'
  ) then
    raise exception 'the CHECK keeping a blend private is gone';
  end if;
end;
$$;

create or replace function private.assert_public_reads_revoked()
returns void
language plpgsql
as $$
declare
  live text;
begin
  select string_agg(polname, ', ') into live
  from pg_policy
  where polname in (
    'recipes_select_public_any',
    'recipe_ingredients_select_public_any',
    'photos_select_public_any'
  );

  if live is not null then
    raise exception
      'the cross-household read surface is back (%) — if public recipe pages now exist, replace this assertion in the same migration that re-creates the policies', live;
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
end;
$outer$;

do $do$
begin
  perform private.assert_rls_invariants();

  -- the household's own reads must be untouched: this revokes a cross-household
  -- permission, not a household's access to its own recipes
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.recipes'::regclass
      and polname = 'recipes_select_in_household'
  ) then
    raise exception 'a household can no longer read its own recipes — too much was revoked';
  end if;
end;
$do$;
