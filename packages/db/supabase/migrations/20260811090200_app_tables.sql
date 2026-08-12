-- App tables — recipe-owned, per docs/architecture.md §5.
--
-- Every household-scoped table carries family_id, even where it could be reached
-- by joining a parent. Two reasons: a policy that has to join is slower and much
-- easier to get subtly wrong, and denormalising the tenant key is what lets the
-- isolation rule be identical on every table instead of bespoke per table.
--
-- The denormalisation is kept honest by composite foreign keys — a child row
-- references (parent_id, family_id) together, so a row claiming a family its
-- parent does not belong to fails at write time rather than leaking later.

-- ---------------------------------------------------------------------------
-- Catalog. Global reference data, not household data.
-- ---------------------------------------------------------------------------

-- The grocery catalog, promoted out of source code. As a table it can be
-- corrected and extended without a release, which is what makes the shopping list
-- get smarter over time instead of frozen at whatever was typed once.
--
-- No family_id: cream comes in pints regardless of whose kitchen it is. Readable
-- by every signed-in user, writable only by the service role — see the RLS
-- migration.
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  -- The domain's stable identifier, e.g. 'heavy-cream'. It surfaces as
  -- ShoppingLine.key, so it has to survive a canonical_name being corrected —
  -- which is why it is a separate column and not a slug of the display name.
  -- Several are deliberately unlike their canonical name: key 'butter' carries
  -- canonical_name 'unsalted butter'.
  key text not null,
  canonical_name text not null,
  aliases text[] not null default '{}',
  aisle text not null,
  -- mirrors the Dimension union in packages/core/src/types.ts. If one moves, both
  -- move; core does the arithmetic and this only has to agree with it.
  dimension text not null check (
    dimension in ('volume', 'weight', 'count', 'clove', 'can', 'bunch')
  ),
  -- lets a volume measure merge into an item sold by weight ("1 cup flour" -> g)
  grams_per_cup numeric check (grams_per_cup > 0),
  -- base-unit contents of one tin, so "1 can beans" becomes a real weight
  can_size numeric check (can_size > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingredients_canonical_name_unique unique (canonical_name),
  constraint ingredients_key_unique unique (key)
);

-- How an ingredient is actually sold. base_amount is in the dimension's base
-- unit — millilitres or grams — because arithmetic never happens on written
-- units. "pint (16 oz)" is stored as 473.176.
create table public.grocery_packages (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  label text not null,
  base_amount numeric not null check (base_amount > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- an ingredient cannot be sold in two different "pint (16 oz)". Also what makes
  -- re-seeding an upsert rather than a duplicate.
  constraint grocery_packages_label_unique unique (ingredient_id, label)
);

-- ---------------------------------------------------------------------------
-- Household data.
-- ---------------------------------------------------------------------------

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  title text not null,
  source_url text,
  source_name text,
  servings integer check (servings > 0),
  -- minutes. Same reasoning as base units elsewhere: a number can be compared and
  -- scaled, "1 hr 20" cannot.
  time_minutes integer check (time_minutes >= 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  make_again boolean,
  times_made integer not null default 0 check (times_made >= 0),
  -- the member, not the account, so the UI can say who added it — including a
  -- household where only one adult has a login
  created_by uuid references public.family_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- the target for child tables' composite foreign keys
  constraint recipes_id_family_id unique (id, family_id)
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  recipe_id uuid not null,
  "position" integer not null,
  -- amount and unit as the recipe wrote them. Conversion to base units is
  -- packages/core's job, and doing it here would lose what the source said.
  amount numeric,
  unit text,
  item_text text not null,
  -- null until the line matches something in the catalog; an unmatched line is
  -- still a shopping list entry
  ingredient_id uuid references public.ingredients (id) on delete set null,
  note text not null default '',
  -- true when the amount was inferred rather than stated. Surfaced on the review
  -- screen, and the flag that matters most for video imports where an amount was
  -- never actually spoken.
  is_estimated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint recipe_ingredients_recipe foreign key (recipe_id, family_id)
    references public.recipes (id, family_id) on delete cascade
);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  recipe_id uuid not null,
  family_member_id uuid not null references public.family_members (id) on delete cascade,
  -- 1-5 is an assumption; nothing in the docs fixes the scale. Widening a check
  -- constraint is a one-line migration if it turns out to be thumbs up/down.
  score smallint not null check (score between 1 and 5),
  rated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ratings_recipe foreign key (recipe_id, family_id)
    references public.recipes (id, family_id) on delete cascade
);

-- one live rating per person per recipe; tombstones excluded so a withdrawn
-- rating can be given again
create unique index ratings_one_per_member
  on public.ratings (recipe_id, family_member_id)
  where deleted_at is null;

create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint meal_plans_id_family_id unique (id, family_id)
);

create unique index meal_plans_one_per_week
  on public.meal_plans (family_id, week_start)
  where deleted_at is null;

create table public.plan_entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  meal_plan_id uuid not null,
  "date" date not null,
  -- required: an entry is a planned recipe. Free-text entries ("leftovers") would
  -- need this nullable, and that is a planner feature nobody has asked for yet.
  recipe_id uuid not null,
  -- batch multiplier, e.g. 1.5 to cook half again as much
  scale numeric not null default 1 check (scale > 0),
  cooked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint plan_entries_meal_plan foreign key (meal_plan_id, family_id)
    references public.meal_plans (id, family_id) on delete cascade,
  constraint plan_entries_recipe foreign key (recipe_id, family_id)
    references public.recipes (id, family_id) on delete cascade
);

create table public.shortlist_entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  week_start date not null,
  recipe_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint shortlist_entries_recipe foreign key (recipe_id, family_id)
    references public.recipes (id, family_id) on delete cascade
);

create unique index shortlist_entries_one_per_week
  on public.shortlist_entries (family_id, week_start, recipe_id)
  where deleted_at is null;

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- null when it is something the catalog has never heard of
  ingredient_id uuid references public.ingredients (id) on delete set null,
  name text not null,
  amount numeric,
  unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  recipe_id uuid not null,
  storage_path text not null,
  source text not null check (source in ('import', 'camera', 'upload')),
  width integer check (width > 0),
  height integer check (height > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint photos_recipe foreign key (recipe_id, family_id)
    references public.recipes (id, family_id) on delete cascade
);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  kind text not null check (kind in ('url', 'text', 'screenshot', 'video')),
  -- a URL, a storage path, or a cache key depending on kind
  input_ref text not null,
  -- 'review' is a real state, not a transition: no import saves without the user
  -- seeing it, which is what allows cheap models to be good enough.
  status text not null default 'queued' check (
    status in ('queued', 'running', 'review', 'saved', 'failed', 'cancelled')
  ),
  result_json jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- The deliberate exception.
-- ---------------------------------------------------------------------------

-- import_cache is keyed by URL hash and belongs to nobody.
--
-- A recipe that goes round Facebook is fetched and parsed ONCE for the entire
-- user base. Scoping this per family would mean re-fetching and re-paying for the
-- same page for every household that saw the post, and at subscription scale that
-- costs more than model choice does (architecture §11).
--
-- So: no family_id, and no household RLS policy. It is written and read only by
-- the import service using the service role, which bypasses RLS. The RLS
-- migration enables row-level security here with no policies at all, which denies
-- every ordinary client rather than exposing a shared table to them.
--
-- The cache holds extracted recipe data and a photo path. It must never hold
-- anything household-identifying — that is what keeps a shared table from becoming
-- a cross-tenant leak.
--
-- url_hash is the primary key rather than a UUID. The UUID rule exists so devices
-- can mint ids offline; this table is never synced to a device, and the hash is
-- the natural key that makes the cache a cache.
create table public.import_cache (
  url_hash text primary key,
  extracted_json jsonb,
  photo_path text,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes. family_id is in every policy, so it is indexed on every table that
-- has one — an unindexed policy column is the difference between a fast query
-- and a sequential scan per statement.
-- ---------------------------------------------------------------------------

create index recipes_family_id on public.recipes (family_id);
create index recipe_ingredients_family_id on public.recipe_ingredients (family_id);
create index recipe_ingredients_recipe_id on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_ingredient_id on public.recipe_ingredients (ingredient_id);
create index ratings_family_id on public.ratings (family_id);
create index ratings_family_member_id on public.ratings (family_member_id);
create index meal_plans_family_id on public.meal_plans (family_id);
create index plan_entries_family_id on public.plan_entries (family_id);
create index plan_entries_meal_plan_id on public.plan_entries (meal_plan_id);
create index plan_entries_recipe_id on public.plan_entries (recipe_id);
create index shortlist_entries_family_id on public.shortlist_entries (family_id);
create index shortlist_entries_recipe_id on public.shortlist_entries (recipe_id);
create index pantry_items_family_id on public.pantry_items (family_id);
create index pantry_items_ingredient_id on public.pantry_items (ingredient_id);
create index photos_family_id on public.photos (family_id);
create index photos_recipe_id on public.photos (recipe_id);
create index import_jobs_family_id on public.import_jobs (family_id);
create index grocery_packages_ingredient_id on public.grocery_packages (ingredient_id);

create trigger set_updated_at before update on public.ingredients
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.grocery_packages
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.recipes
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.recipe_ingredients
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.ratings
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.meal_plans
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.plan_entries
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.shortlist_entries
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.pantry_items
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.photos
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.import_jobs
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.import_cache
  for each row execute function private.set_updated_at();
