-- ---------------------------------------------------------------------------
-- How this household decides what to cook (§85).
--
-- A household setting beside `measurement_system`, `timezone` and
-- `avoided_allergens`, and the reason it is a setting rather than an inference
-- is §71's: **a declared fact beats a derived one.** A household that answers
-- "it depends how much time we've got" has told us something no amount of
-- behaviour would establish, and it has told us on purpose.
--
-- The problem it solves is measured rather than asserted: 67 recipes in one
-- scroll is roughly ten times the choice-overload threshold the research puts at
-- five to seven. The constraint the layouts obey is not *group them* — "Mains
-- 28" is still 28 once tapped — it is **never show more than about seven at
-- once**.
--
-- Two columns, because "not now" and "never asked" are different states and
-- only one of them should ever re-prompt:
--
--   recipe_layout          what to render. NOT NULL with a default, so every
--                          read is safe and no screen needs a fallback branch.
--   recipe_layout_asked_at when the question was answered — by choosing, or by
--                          dismissing. NULL means nobody has been asked, and
--                          **only NULL prompts**. A dismissal is therefore free
--                          and permanent, which is what makes asking in context
--                          acceptable at all.
--
-- The default is the real decision. Most households never open a setting, so
-- whatever ships as the default is what nearly everyone gets — and `rotation` is
-- the only one of the five that is true on day one, because `plan_entries` holds
-- real rows where `times_made` tops out at 2.
-- ---------------------------------------------------------------------------

/*
 * The five, as a function rather than inline, so one place names them.
 *
 * Must stay in step with the `RecipeLayout` union in `apps/web/lib/recipe-layout.ts`, which SQL
 * cannot import — the two-sites problem this codebase has paid for repeatedly. A test compares
 * this list against the union, so a value added on one side and not the other fails a test rather
 * than silently rejecting a legitimate setting.
 */
create or replace function private.known_recipe_layouts()
returns text[]
language sql
immutable
as $$
  select array['rotation', 'browse', 'time', 'protein', 'decide']::text[]
$$;

alter table public.families
  add column recipe_layout text not null default 'rotation'
    constraint families_recipe_layout_is_known
      check (recipe_layout = any (private.known_recipe_layouts())),
  add column recipe_layout_asked_at timestamptz;

comment on column public.families.recipe_layout is
  'How this household decides what to cook, which sets how /recipes is laid out. A declared fact about the household rather than an inference from behaviour (§71, §85). Default rotation because it is the only one true on day one.';

comment on column public.families.recipe_layout_asked_at is
  'When the in-context question was answered — by choosing a layout, or by dismissing it. NULL means never asked, and only NULL prompts. "Not now" and "never asked" are different states and conflating them would re-ask forever.';

create or replace function private.assert_recipe_layout_is_a_household_setting()
returns void
language plpgsql
as $$
begin
  -- the constraint has to exist, or an unknown value reaches a screen that has no branch for it
  -- and renders nothing: a layout that quietly stops laying out is the worst shape here
  if not exists (
    select 1 from pg_constraint
    where conname = 'families_recipe_layout_is_known'
      and conrelid = 'public.families'::regclass
  ) then
    raise exception 'families.recipe_layout has no CHECK, so an unknown layout could reach a screen with no branch for it';
  end if;

  -- NOT NULL with a default is what lets every read skip a fallback. Without it, a null would
  -- reach the same screens an unknown value would.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'families'
      and column_name = 'recipe_layout' and is_nullable = 'YES'
  ) then
    raise exception 'families.recipe_layout is nullable, so a screen would need a fallback branch nothing tests';
  end if;

  /*
   * And the asked-at column must stay nullable, which is the opposite requirement and the point
   * of having two columns. A NOT NULL default on it would make every existing household look as
   * though it had already been asked, so the prompt would never appear for anybody.
   */
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'families'
      and column_name = 'recipe_layout_asked_at' and is_nullable = 'NO'
  ) then
    raise exception 'families.recipe_layout_asked_at is NOT NULL, so every household reads as already asked and the prompt can never appear';
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
  perform private.assert_recipe_layout_is_a_household_setting();
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
    if has_column_privilege(grantee, 'public.families'::regclass, 'recipe_layout', 'UPDATE') then
      raise exception 'a client can write recipe_layout as % directly — it is a platform setting', grantee;
    end if;
    if has_column_privilege(grantee, 'public.families'::regclass, 'recipe_layout_asked_at', 'UPDATE') then
      raise exception 'a client can write recipe_layout_asked_at as % directly — a household could then un-ask its own prompt', grantee;
    end if;
  end loop;

  /*
   * The predicate is checked here; the *write* is attempted in the test.
   *
   * A `DO` block has no household to hang a row on, and a probe inserted here would be refused
   * for the wrong reason — `owner_account_id` is NOT NULL and has nothing to do with this. The
   * allergen migration already paid for that lesson: a probe that cannot succeed has measured
   * nothing. So the predicate behind the constraint is exercised directly.
   */
  if 'shelves' = any (private.known_recipe_layouts()) then
    raise exception 'private.known_recipe_layouts() admits a layout that was dropped, so the check it backs would let a value through that no screen renders';
  end if;

  if not ('rotation' = any (private.known_recipe_layouts())) then
    raise exception 'private.known_recipe_layouts() rejects the default, so every household would fail its own CHECK';
  end if;

end;
$do$;
