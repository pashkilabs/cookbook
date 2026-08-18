-- ---------------------------------------------------------------------------
-- What a recipe is, and when a meal is eaten.
--
-- Two gaps that read as one: the schema had no notion of what a recipe *is* —
-- no course, no cuisine — and `plan_entries` tied a recipe to a date with no
-- slot, so breakfast and dinner were indistinguishable and a meal of several
-- recipes could not be expressed at all.
--
-- ---------------------------------------------------------------------------
-- (date, slot) IS the meal. There is no meals table.
-- ---------------------------------------------------------------------------
--
-- A meal is the entries sharing a date and a slot within a plan. That is the
-- whole model, and the reason not to add a `meals` table is that it would be a
-- **second identity for the same thing** — the failure this repo has already paid
-- for, where a convention encoded in two places keeps matching the old shape after
-- one of them moves.
--
-- It also keeps the two things that had to survive untouched: `plan_entries` is
-- still the row the shopping list sums over, and `scale` is still per entry, so
-- one recipe in a meal can be cooked half again without the others.
--
-- **The shopping list stays week-scoped and consolidates across slots.** Cream is
-- bought once for the week, not once per meal. Slot is display: it says where a
-- recipe sits on a day, and buys nothing at the shop.
--
-- ---------------------------------------------------------------------------
-- Course and cuisine are the recipe's. Role on the plate is not, and is absent.
-- ---------------------------------------------------------------------------
--
-- Course and cuisine are properties of the dish: a caption reading "MARRY ME
-- ITALIAN SAUSAGE SOUP" gives both, free, from a model already reading the recipe.
--
-- Role on the plate is a property of a recipe's *use* — a lentil soup is the
-- protein on Monday and a side on Sunday — so a single stored answer would be
-- wrong often enough that the filter stops being trusted. Deliberately not a
-- column. Whether it is needed at all is a question the browse flow answers.
--
-- Both nullable, because unknown has to be representable. A NOT NULL with a
-- default would push the extractor into guessing, which is the same mistake as
-- inventing an amount a caption does not state.
-- ---------------------------------------------------------------------------

alter table public.plan_entries
  add column slot text not null default 'dinner'
    check (slot in ('breakfast', 'lunch', 'dinner', 'snack'));

-- every existing entry was a dinner, because that is what a planner with no slots
-- meant; the default states it rather than leaving it implied
comment on column public.plan_entries.slot is
  'Which meal of the day. (date, slot) identifies the meal an entry belongs to — there is no meals table.';

alter table public.recipes
  add column course text
    check (course in ('breakfast', 'starter', 'main', 'side', 'dessert', 'drink', 'snack')),
  add column cuisine text check (length(cuisine) between 1 and 40);

comment on column public.recipes.course is 'Inferred at import, corrected on the review screen. Null when unknown.';
comment on column public.recipes.cuisine is
  'Free text rather than a closed list: cuisines do not enumerate, and a CHECK would refuse real answers.';

-- ---------------------------------------------------------------------------
-- Column grants, because a policy is not a privilege.
--
-- Postgres checks table privileges before row-level security, and this schema
-- grants **columns, not tables** (§26) — so a new column is unwritable by clients
-- until it is named here, while every policy looks correct and every insert fails.
-- ---------------------------------------------------------------------------

grant insert (slot), update (slot) on public.plan_entries to authenticated;
grant insert (course, cuisine), update (course, cuisine) on public.recipes to authenticated;

do $do$
declare
  missing text[];
begin
  select coalesce(array_agg(t.rel || '.' || t.col || ' (' || t.priv || ')' order by t.rel, t.col, t.priv), '{}')
  into missing
  from (values
    ('public.plan_entries', 'slot', 'INSERT'), ('public.plan_entries', 'slot', 'UPDATE'),
    ('public.recipes', 'course', 'INSERT'),    ('public.recipes', 'course', 'UPDATE'),
    ('public.recipes', 'cuisine', 'INSERT'),   ('public.recipes', 'cuisine', 'UPDATE')
  ) as t(rel, col, priv)
  where not has_column_privilege('authenticated', t.rel::regclass, t.col, t.priv);

  if array_length(missing, 1) > 0 then
    raise exception 'authenticated cannot write the new columns: %', array_to_string(missing, ', ');
  end if;

  -- and the other direction: anon must not have gained anything
  if has_column_privilege('anon', 'public.recipes'::regclass, 'course', 'UPDATE')
     or has_column_privilege('anon', 'public.plan_entries'::regclass, 'slot', 'UPDATE') then
    raise exception 'anon can write classification or slot';
  end if;

  -- the columns a client must never assert are still off limits, so this migration
  -- has not widened the grant matrix sideways while adding to it
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'updated_at', 'UPDATE') then
    raise exception 'authenticated can stamp its own updated_at';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
