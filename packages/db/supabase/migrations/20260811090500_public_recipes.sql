-- Public recipe pages.
--
-- A visibility flag, not a share token. The growth loop in decisions §2 is a page
-- that opens for someone with no account and is **indexable** — that is a public
-- flag. A share token grants access to whoever holds a link and must carry
-- `noindex`, which is a different product: unlisted sharing. Nobody has asked for
-- it, and building it would mean designing rotation, revocation and leak semantics
-- with no consumer. See docs/decisions.md §17.
--
-- Default is 'private'. Nothing becomes readable by publishing this migration.

alter table public.recipes
  add column visibility text not null default 'private'
    check (visibility in ('private', 'public'));

comment on column public.recipes.visibility is
  'private (default) or public. Public means world-readable and indexable by anon — not an unlisted link.';

-- Publication is controlled by visibility alone, plus not-deleted. Deliberately not
-- by `status`: archiving means "not cooking this at the moment", which is an
-- organisational state, and having it silently 404 a page somebody linked to would
-- be surprising.
--
-- Deleted rows are excluded here even though tombstones stay readable inside the
-- household. That rule exists so a sync peer can observe a deletion; anon is not
-- syncing, and a deleted recipe must stop being a public page.
create index recipes_public_created_at
  on public.recipes (created_at desc)
  where visibility = 'public' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Is this recipe published?
--
-- Child tables need the answer without re-deriving it, and SECURITY DEFINER keeps
-- the decision in one place rather than depending on how the recipes policies
-- happen to interact with a subquery.
-- ---------------------------------------------------------------------------

create or replace function private.recipe_is_public(p_recipe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.recipes r
    where r.id = p_recipe_id
      and r.visibility = 'public'
      and r.deleted_at is null
  )
$$;

comment on function private.recipe_is_public is
  'True when a recipe is published. Used by the anon-readable policies on child tables.';

-- anon needs to reach the helper the policies call. The private schema is not in
-- [api] schemas, so this does not make the function callable through the API — only
-- usable by the policy that references it.
grant usage on schema private to anon;

-- ---------------------------------------------------------------------------
-- Column-level grants.
--
-- RLS decides which ROWS anon may read; grants decide which COLUMNS. Both are
-- needed here, because a public recipe row still carries household data —
-- family_id identifies the household, and make_again / times_made / created_by are
-- private signals about how that household cooks.
--
-- Column privileges are the right tool rather than a view: a view would need its
-- own policies and its own drift. The consequence is that `select *` as anon fails
-- with a permission error instead of silently returning a subset, which is the safe
-- direction and is asserted in the tests.
-- ---------------------------------------------------------------------------

grant select (
  id,
  title,
  servings,
  time_minutes,
  -- attribution is required, not optional: decisions §12 says link back
  source_url,
  source_name,
  visibility,
  -- publication and last-modified dates, which an indexable page wants
  created_at,
  updated_at
) on public.recipes to anon;

grant select (
  id,
  recipe_id,
  "position",
  amount,
  unit,
  item_text,
  note,
  -- worth showing a reader: this amount was inferred rather than stated
  is_estimated
) on public.recipe_ingredients to anon;

grant select (
  id,
  recipe_id,
  storage_path,
  width,
  height,
  source
) on public.photos to anon;

-- ---------------------------------------------------------------------------
-- Policies for anon.
-- ---------------------------------------------------------------------------

create policy recipes_select_public on public.recipes
  for select to anon
  using (visibility = 'public' and deleted_at is null);

create policy recipe_ingredients_select_public on public.recipe_ingredients
  for select to anon
  using (deleted_at is null and private.recipe_is_public(recipe_id));

-- Only the household's own photograph.
--
-- `source = 'camera'` is the family's picture of the finished plate: theirs to
-- publish. An 'import' photo is the original blogger's, and republishing it
-- world-readable is exactly what the unresolved copyright question in
-- docs/decisions.md governs. This is the conservative subset that does not need
-- that question answered; widening it is one migration once it is.
create policy photos_select_public on public.photos
  for select to anon
  using (
    deleted_at is null
    and source = 'camera'
    and private.recipe_is_public(recipe_id)
  );

-- ---------------------------------------------------------------------------
-- Policies for authenticated: a signed-in person may read anyone's public recipe.
--
-- Permissive policies OR together, so this sits alongside the household policy
-- rather than replacing it. Without it, following a friend's link while signed in
-- would fail — which is the common case, not the edge one.
--
-- **This is the loosening that promotes the UPDATE policy from redundant to
-- load-bearing.** Postgres checks the new row of an UPDATE against SELECT policies;
-- while the SELECT policy was household-only it masked the UPDATE policy entirely.
-- Now that another household's public row is visible, the UPDATE policy is the only
-- thing stopping a stranger editing a published recipe. scripts/mutate-rls.sh
-- proves it: the two mutations that used to report `masked` must now be `caught`.
-- ---------------------------------------------------------------------------

create policy recipes_select_public_any on public.recipes
  for select to authenticated
  using (visibility = 'public' and deleted_at is null);

create policy recipe_ingredients_select_public_any on public.recipe_ingredients
  for select to authenticated
  using (deleted_at is null and private.recipe_is_public(recipe_id));

create policy photos_select_public_any on public.photos
  for select to authenticated
  using (deleted_at is null and private.recipe_is_public(recipe_id));

-- ---------------------------------------------------------------------------
-- Self-check: what anon can reach, and nothing else.
--
-- "Readable by anon" is the part of this migration most likely to grow a hole
-- later, and a hole here is a stranger reading a household's meal plan. The
-- allowed surface is therefore asserted positively and negatively at apply time.
-- ---------------------------------------------------------------------------

do $do$
declare
  forbidden_tables text[] := array[
    'accounts', 'families', 'family_members', 'devices', 'subscriptions',
    'entitlements', 'ratings', 'meal_plans', 'plan_entries', 'shortlist_entries',
    'pantry_items', 'import_jobs', 'import_cache', 'ingredients', 'grocery_packages'
  ];
  -- household signals that live on an otherwise publishable row
  forbidden_columns text[] := array[
    'family_id', 'created_by', 'make_again', 'times_made', 'status', 'deleted_at'
  ];
  readable_tables text[] := array['recipes', 'recipe_ingredients', 'photos'];
  target text;
  column_name text;
  privilege text;
begin
  foreach target in array forbidden_tables loop
    foreach privilege in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege('anon', 'public.' || target, privilege) then
        raise exception 'anon has % on %, which would expose household data', privilege, target;
      end if;
    end loop;
  end loop;

  -- anon may read the three publishable tables, but must never write them
  foreach target in array readable_tables loop
    foreach privilege in array array['insert', 'update', 'delete'] loop
      if has_table_privilege('anon', 'public.' || target, privilege) then
        raise exception 'anon has % on %', privilege, target;
      end if;
    end loop;
  end loop;

  foreach column_name in array forbidden_columns loop
    if has_column_privilege('anon', 'public.recipes', column_name, 'select') then
      raise exception
        'anon can read recipes.%, which leaks the household behind a public page',
        column_name;
    end if;
  end loop;

  if has_column_privilege('anon', 'public.recipe_ingredients', 'family_id', 'select') then
    raise exception 'anon can read recipe_ingredients.family_id';
  end if;

  if has_column_privilege('anon', 'public.photos', 'family_id', 'select') then
    raise exception 'anon can read photos.family_id';
  end if;

  -- and the positive half, so a future tightening cannot silently empty the page
  if not has_column_privilege('anon', 'public.recipes', 'title', 'select')
     or not has_column_privilege('anon', 'public.recipes', 'source_url', 'select')
     or not has_column_privilege('anon', 'public.recipe_ingredients', 'item_text', 'select') then
    raise exception 'anon cannot read enough to render a public recipe page';
  end if;
end;
$do$;
