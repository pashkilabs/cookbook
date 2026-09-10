-- ---------------------------------------------------------------------------
-- Keep the heading the recipe wrote.
--
-- `ParsedIngredient.section` has existed since the parser did, the vision schema
-- asks the model for it, and `parseSectionedIngredients` assembles it — and nothing
-- ever stored it. It was computed on every import and discarded at save, so a card
-- reading "Frosting:" arrived with its structure and was saved without it.
--
-- The same shape as the card photograph: data that exists at extraction and is lost
-- before storage, invisible because nothing downstream asked for it.
--
-- It matters now because a component is what recipe blending is built on (§60), and
-- a declared section is the strongest evidence a recipe gives about its own
-- components. Every import until this lands loses that evidence permanently — a
-- re-parse cannot recover a heading that was never written down.
-- ---------------------------------------------------------------------------

alter table public.recipe_ingredients
  add column section text check (section is null or length(section) between 1 and 80);

comment on column public.recipe_ingredients.section is
  'The heading this line appeared under, as the recipe wrote it — "Frosting", "For the sauce". Null when the recipe declared none, which is most captions. Evidence for component inference (§60), not a taxonomy: sections are per recipe and are never matched across them.';

-- a client writes ingredients through the review screen, so it needs the column;
-- this schema grants columns rather than tables (§26)
grant insert (section), update (section) on public.recipe_ingredients to authenticated;

do $do$
begin
  if not has_column_privilege('authenticated', 'public.recipe_ingredients'::regclass, 'section', 'INSERT') then
    raise exception 'the review screen cannot save the heading a recipe wrote';
  end if;

  if has_column_privilege('anon', 'public.recipe_ingredients'::regclass, 'section', 'UPDATE') then
    raise exception 'anon can write ingredient sections';
  end if;

  -- the matrix has not widened sideways while being added to
  if has_column_privilege('authenticated', 'public.recipe_ingredients'::regclass, 'updated_at', 'UPDATE') then
    raise exception 'authenticated can stamp its own updated_at';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
