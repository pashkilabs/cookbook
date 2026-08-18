-- ---------------------------------------------------------------------------
-- Two more axes on a recipe, and neither of them is `course`.
--
-- The browse sketch puts Soup and Salad beside Mains at the top level, which
-- reads as three courses and is not. **A soup is a main and a soup**; a salad is
-- a side or a main and a salad. Forcing either into `course` would demand a
-- choice that does not exist, and it would overturn the rule the classification
-- measurement rests on — "anything substantial enough to be the centre of a meal
-- is a main, including soups". That measurement is 18/18 across the caption set,
-- and `course` is untouched here so it still holds.
--
-- So the sketch's top level is **presentation over three fields**, not a column:
--
--   Appetizers        course = 'starter'
--   Soup / Salad      dish_form
--   Mains             course = 'main'      -> then principal_protein
--   Desserts, Drinks  course
--   Breakfast/Brunch  course = 'breakfast' (the picker chooses a recipe; slot
--                     does its job at planning time)
--   Lunch             slot, on planned entries
--
-- A soup that is a main therefore appears under both Soup and Mains. That is
-- correct and is the reason the axes stay separate — it is how a person looks for
-- things, and it will be reported as a bug by someone who has not read this.
--
-- ---------------------------------------------------------------------------
-- Kid-friendly is deliberately absent
-- ---------------------------------------------------------------------------
--
-- It is not a property of the recipe: it is a household's judgement, and the data
-- already exists in `ratings` joined to `family_members.is_child`. A column would
-- be one household's answer given to every household, and would go stale the
-- moment a child changed their mind. Computed in a view or a query helper — at
-- least one child rating 4+, and no child rating below 4.
--
-- ---------------------------------------------------------------------------
-- Both lists are deliberately small
-- ---------------------------------------------------------------------------
--
-- `dish_form` carries the two forms the sketch needs plus four obvious
-- neighbours, and grows when a screen needs more. The same discipline as
-- container sizes: assert what is known rather than building a taxonomy nobody
-- has asked for. Both nullable, because most recipes are neither a soup nor a
-- salad and "unknown" has to be representable — a NOT NULL with a default would
-- push the extractor into guessing.
-- ---------------------------------------------------------------------------

alter table public.recipes
  add column dish_form text
    check (dish_form in ('soup', 'salad', 'sandwich', 'bake', 'stew', 'bowl')),
  add column principal_protein text
    check (principal_protein in
      ('chicken', 'beef', 'pork', 'lamb', 'fish', 'seafood', 'egg', 'vegetarian', 'vegan'));

comment on column public.recipes.dish_form is
  'What shape the dish takes. Orthogonal to course: a soup is a main AND a soup.';
comment on column public.recipes.principal_protein is
  'The protein a main is built around — the axis the browse sketch leans on. Null when there is none or it is unclear.';

-- ---------------------------------------------------------------------------
-- Column grants, because a policy is not a privilege (§26).
-- ---------------------------------------------------------------------------

grant insert (dish_form, principal_protein), update (dish_form, principal_protein)
  on public.recipes to authenticated;

do $do$
declare
  missing text[];
begin
  select coalesce(array_agg(t.col || ' (' || t.priv || ')' order by t.col, t.priv), '{}')
  into missing
  from (values
    ('dish_form', 'INSERT'), ('dish_form', 'UPDATE'),
    ('principal_protein', 'INSERT'), ('principal_protein', 'UPDATE')
  ) as t(col, priv)
  where not has_column_privilege('authenticated', 'public.recipes'::regclass, t.col, t.priv);

  if array_length(missing, 1) > 0 then
    raise exception 'authenticated cannot write the new columns: %', array_to_string(missing, ', ');
  end if;

  if has_column_privilege('anon', 'public.recipes'::regclass, 'dish_form', 'UPDATE')
     or has_column_privilege('anon', 'public.recipes'::regclass, 'principal_protein', 'UPDATE') then
    raise exception 'anon can write the new classification columns';
  end if;

  -- the matrix has not widened sideways while being added to
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'updated_at', 'UPDATE') then
    raise exception 'authenticated can stamp its own updated_at';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
