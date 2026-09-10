-- ---------------------------------------------------------------------------
-- A blend is a recipe row with a lineage (§60 step 4).
--
-- Not a jsonb column on `recipes`. The two jsonb columns there — `palate_notes`
-- and `components` — are both derived caches, safe to delete and recomputed on
-- next view. A lineage is authored and **unrecomputable**: once a source is
-- edited or gone, nothing can work out again which four lines were the glaze.
--
-- ---------------------------------------------------------------------------
-- The composite foreign key IS §60's household check
-- ---------------------------------------------------------------------------
--
-- "Every source must share the blend's family_id, checked rather than assumed."
-- `(source_recipe_id, family_id) references recipes (id, family_id)` is that
-- check, at write time, in the database — not a line of route code somebody can
-- forget. The route checks too, so a stranger's recipe produces a sentence rather
-- than a constraint violation, but the guarantee lives here.
--
-- RLS will not do this job: published recipes are world-readable by design (§17),
-- which is how the recipe list once rendered another household's roast chicken.
-- A policy decides what may leave the database; this decides what may be built on.
--
-- ---------------------------------------------------------------------------
-- Snapshot, not live — and the two propagation modes differ on purpose
-- ---------------------------------------------------------------------------
--
--   blend_recipe_id  -> tombstone. Deleting the blend takes its lineage. Right.
--   source_recipe_id -> nullify.   Deleting a source must leave the blend whole.
--
-- `tombstone` on the source would delete a dish the household has already cooked
-- because they tidied away something it was once built from — the exact opposite
-- of "a blend does not change when its sources are edited". `nullify` forgets the
-- pointer and keeps the dish, which is why `component_name`, `role` and
-- `source_title` are copied onto this row: the snapshot has to survive the
-- pointer. `nullify` has no restore — a restored source does not reclaim its
-- blends — and that is stated rather than half-built.
--
-- ---------------------------------------------------------------------------
-- A blend may never be published, and that is a boundary rather than a default
-- ---------------------------------------------------------------------------
--
-- §17 publishes a household's own recipes to the world. A blend is a derivative
-- of two bloggers' prose, which is a different thing from a household's own
-- photograph of its own dinner, and the copyright posture (§open 3) is unsettled.
-- Private is the same footing the imported prose already sits on: nothing new
-- leaves the household.
--
-- Enforced three ways rather than remembered, mirroring how a source photograph
-- is kept out of a published recipe:
--
--   1. a CHECK, so the row cannot exist — the strongest of the three
--   2. `derived_at is null` in the public policy AND in `recipe_is_public`,
--      because the child tables read the function and the parent reads the
--      policy: blocking one would still leak a blend's ingredient list
--   3. `assert_blends_never_public`, chained into assert_rls_invariants, which
--      fails the migration if either the policy or the function stops saying so
--
-- If published recipes are ever widened, this must stay narrow.
-- ---------------------------------------------------------------------------

alter table public.recipes
  add column derived_at timestamptz,
  -- the marker a CHECK can see. `recipe_derivations` holds the detail, but a CHECK
  -- cannot subquery, and this rule is worth a column to make unbreakable
  add constraint recipes_blends_are_never_public
    check (derived_at is null or visibility = 'private');

comment on column public.recipes.derived_at is
  'When this recipe was assembled from others (§60 step 4). Null for an ordinary recipe. A recipe with this set can never be published: it is a derivative of somebody else''s prose, not a household''s own work.';

-- authenticated may not set it: a blend is created through the route, which is the
-- only thing that also writes the lineage rows. A client that could stamp this
-- could mark any recipe a blend, or unmark one to publish it.
revoke insert (derived_at), update (derived_at) on public.recipes from authenticated;

create table public.recipe_derivations (
  id uuid primary key default gen_random_uuid(),
  -- no direct reference to `families`: the composite FKs below carry the household
  family_id uuid not null,
  blend_recipe_id uuid not null,
  -- nullable, because `nullify` needs somewhere to put the null
  source_recipe_id uuid,
  "position" integer not null check ("position" >= 0),
  -- 'whole' rests on no partition at all, so it owes no agreement and takes no
  -- role. It is what makes this work on a recipe nothing has split yet — and on a
  -- deployment with no model configured at all.
  taken text not null check (taken in ('component', 'whole')),
  -- snapshots: what this part was called and where it came from, as they were
  component_name text not null check (length(component_name) between 1 and 120),
  role text check (role in (
    'protein', 'carbohydrate', 'sauce', 'vegetable', 'garnish', 'marinade', 'sweet'
  )),
  source_title text not null check (length(source_title) between 1 and 200),
  -- inclusive ranges over the BLEND's own lists. The source's own positions are
  -- deliberately not stored: editing a source tombstones and re-inserts its rows,
  -- because position is the only identity a line has, so a stored index into it
  -- would still parse, still look valid, and name different lines.
  ingredients_from integer not null check (ingredients_from >= 0),
  ingredients_to integer not null check (ingredients_to >= ingredients_from),
  -- null when the source stored no method at all (§19 links back rather than
  -- reproducing), which is a real case and not an error
  steps_from integer check (steps_from >= 0),
  steps_to integer check (steps_to >= steps_from),
  -- the blend's own lists have the same hazard the moment somebody edits the
  -- blend, so each range fingerprints the lines it covered when written. On read
  -- the key is recomputed: a mismatch means the part is stale and the screen says
  -- so. EXTRACTOR_VERSION with the human step removed.
  lines_key text not null check (length(lines_key) between 1 and 120),
  steps_key text check (steps_key is null or length(steps_key) between 1 and 120),
  -- How well the SOURCE's split was agreed at the moment of the cut. Snapshotted
  -- so the blend neither gains nor loses confidence when the source is re-read.
  -- Stored to be SHOWN and never gated on: §61 measured this number separating
  -- right from wrong at 50/50 either side of 0.7. Kept because the reverse claim
  -- survives — low agreement is evidence of trouble even though high agreement is
  -- not evidence of correctness — so a screen may render it as a caution and never
  -- as a credential.
  source_agreement numeric
    check (source_agreement is null or (source_agreement >= 0 and source_agreement <= 1)),
  source_readings smallint
    check (source_readings is null or source_readings between 0 and 3),
  -- whether a person moved the boundaries the model proposed. §61 leaves no
  -- confidence signal, so the person is the only evaluator — and every correction
  -- is a hand label produced as a side effect of use, on exactly the recipes this
  -- household cares about. Free to store now, unrecoverable later.
  adjusted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint recipe_derivations_steps_paired
    check ((steps_from is null) = (steps_to is null)
           and (steps_from is null) = (steps_key is null)),
  -- the two columns mean "three runs agreed this much"; one without the other is
  -- the failure 20260910120000 closed, arriving in a new table
  constraint recipe_derivations_measured_together
    check ((source_agreement is null) = (source_readings is null)),
  -- a whole-recipe take carrying an agreement would be claiming a partition it
  -- never used
  constraint recipe_derivations_whole_is_unmeasured
    check (taken = 'component'
           or (source_agreement is null and source_readings is null and role is null)),
  constraint recipe_derivations_blend foreign key (blend_recipe_id, family_id)
    references public.recipes (id, family_id) on delete cascade,
  -- the column list on SET NULL is mandatory: without it the delete tries to null
  -- family_id, which is NOT NULL, and fails instead
  constraint recipe_derivations_source foreign key (source_recipe_id, family_id)
    references public.recipes (id, family_id) on delete set null (source_recipe_id)
);

comment on table public.recipe_derivations is
  'Which part of which recipe became which lines of a blend (§60 step 4). Authored, not derived: once a source is edited nothing can work this out again.';

create unique index recipe_derivations_one_per_position
  on public.recipe_derivations (blend_recipe_id, "position")
  where deleted_at is null;

create index recipe_derivations_blend
  on public.recipe_derivations (family_id, blend_recipe_id)
  where deleted_at is null;

create index recipe_derivations_source
  on public.recipe_derivations (family_id, source_recipe_id)
  where deleted_at is null;

create trigger set_updated_at_on_recipe_derivations
  before update on public.recipe_derivations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- The same four policies every household table gets, and the same grant shape.
-- ---------------------------------------------------------------------------

alter table public.recipe_derivations enable row level security;

create policy recipe_derivations_select_in_household on public.recipe_derivations
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

create policy recipe_derivations_insert_in_household on public.recipe_derivations
  for insert to authenticated
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy recipe_derivations_update_in_household on public.recipe_derivations
  for update to authenticated
  using (family_id in (select private.current_family_ids()))
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

grant select, insert, update, delete on public.recipe_derivations to service_role;

-- Column-level, per §26. A client may create a lineage and tombstone one; it may
-- not rewrite what a part was called after the fact, restate its agreement, or
-- stamp its own timestamps.
grant select on public.recipe_derivations to authenticated;
grant insert (
  id, family_id, blend_recipe_id, source_recipe_id, "position", taken,
  component_name, role, source_title, ingredients_from, ingredients_to,
  steps_from, steps_to, lines_key, steps_key, source_agreement, source_readings,
  adjusted
) on public.recipe_derivations to authenticated;
grant update (deleted_at) on public.recipe_derivations to authenticated;

-- ---------------------------------------------------------------------------
-- Soft-delete propagation. `ON DELETE CASCADE` does not fire on an UPDATE that
-- sets deleted_at, and every deletion here is one of those.
-- ---------------------------------------------------------------------------

create trigger propagate_delete_to_recipe_derivations_blend_recipe_id
  after update of deleted_at on public.recipes
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete(
    'recipe_derivations', 'blend_recipe_id', 'tombstone');

create trigger restore_delete_to_recipe_derivations_blend_recipe_id
  after update of deleted_at on public.recipes
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.restore_soft_delete(
    'recipe_derivations', 'blend_recipe_id');

create trigger propagate_delete_to_recipe_derivations_source_recipe_id
  after update of deleted_at on public.recipes
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete(
    'recipe_derivations', 'source_recipe_id', 'nullify');

-- ---------------------------------------------------------------------------
-- A blend never reaches a public read path. Both doors.
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
      -- a blend is a derivative of somebody else's prose (§60, §open 3)
      and r.derived_at is null
  )
$$;

drop policy if exists recipes_select_public_any on public.recipes;
create policy recipes_select_public_any on public.recipes
  for select to authenticated
  using (visibility = 'public' and deleted_at is null and derived_at is null);

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

  if policy_expression is null then
    raise exception 'recipes_select_public_any is gone — the public read path is unguarded';
  end if;
  if policy_expression not like '%derived_at%' then
    raise exception
      'recipes_select_public_any no longer excludes blends (§60 step 4)';
  end if;

  -- and the constraint that makes the row impossible rather than merely unreadable
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.recipes'::regclass
      and conname = 'recipes_blends_are_never_public'
  ) then
    raise exception 'the CHECK keeping a blend private is gone';
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
end;
$outer$;

do $do$
begin
  perform private.assert_rls_invariants();

  -- the grant matrix, asserted rather than assumed: hosted grants new tables to
  -- anon and authenticated by default and the local image does not, so a
  -- local-only green says nothing about production
  if has_table_privilege('anon', 'public.recipe_derivations', 'SELECT') then
    raise exception 'anon can read a household''s blend lineage';
  end if;
  if has_column_privilege('authenticated', 'public.recipe_derivations'::regclass, 'updated_at', 'UPDATE') then
    raise exception 'authenticated can stamp its own updated_at on a derivation';
  end if;
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'derived_at', 'UPDATE') then
    raise exception 'a client can mark a recipe a blend, or unmark one to publish it';
  end if;
  if not has_column_privilege('authenticated', 'public.recipe_derivations'::regclass, 'component_name', 'INSERT') then
    raise exception 'a household cannot record what a part was called';
  end if;
end;
$do$;
