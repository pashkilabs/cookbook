-- What has already been picked up.
--
-- The shopping list itself is derived — `consolidate()` merges the week's planned recipes into
-- lines every time the page is read, so there is nothing to store and nothing to keep in step.
-- The one piece of state that cannot be derived is which of those lines somebody has already
-- put in the trolley, and it has to survive a reload: a shopping list you have to re-tick after
-- the signal drops in the shop is worse than a paper one.
--
-- **A row per tick, not a JSON blob on `meal_plans`.** The blob is tempting — the scope is
-- exactly (family, week), which is what a `meal_plans` row already is — but two phones in the
-- same shop would each rewrite the whole blob and last-write-wins would silently drop the other
-- person's ticks. Per-row is what the rest of this schema does, and it is what makes a sync
-- engine's conflict resolution correct rather than lucky (§11).
--
-- `item_key` is the consolidated line's key: a catalog key like `double-cream`, or a normalised
-- name when the catalog has never heard of it. It is deliberately not a foreign key to
-- `ingredients` — a line can exist for something uncatalogued, and a tick for a line that later
-- disappears (the plan changed) is simply ignored, then honoured again if it returns.

create table public.shopping_ticks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  week_start date not null,
  item_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- one live tick per item per week; tombstones excluded so unticking and re-ticking works
create unique index shopping_ticks_one_per_item
  on public.shopping_ticks (family_id, week_start, item_key)
  where deleted_at is null;

create index shopping_ticks_family_week
  on public.shopping_ticks (family_id, week_start)
  where deleted_at is null;

create trigger set_updated_at
  before update on public.shopping_ticks
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- The same four policies every household table gets, and the same grant shape.
-- ---------------------------------------------------------------------------

alter table public.shopping_ticks enable row level security;

create policy shopping_ticks_select_in_household on public.shopping_ticks
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

create policy shopping_ticks_insert_in_household on public.shopping_ticks
  for insert to authenticated
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy shopping_ticks_update_in_household on public.shopping_ticks
  for update to authenticated
  using (family_id in (select private.current_family_ids()))
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy shopping_ticks_delete_in_household on public.shopping_ticks
  for delete to authenticated
  using (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

grant select, insert, update, delete on public.shopping_ticks to service_role;

-- Column-level, per decisions §26: a client writes the columns that represent its decisions and
-- nothing else. `created_at` and `updated_at` are the database's — a row dated in the future
-- wins last-write-wins forever — and DELETE is revoked because a hard-deleted row cannot be told
-- from one that never synced.
grant select on public.shopping_ticks to authenticated;
grant insert (id, family_id, week_start, item_key) on public.shopping_ticks to authenticated;
grant update (deleted_at) on public.shopping_ticks to authenticated;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
