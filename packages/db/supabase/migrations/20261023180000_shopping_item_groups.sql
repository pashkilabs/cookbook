/*
 * ---------------------------------------------------------------------------
 * Which group an ITEM belongs in — standing, not weekly
 * ---------------------------------------------------------------------------
 *
 * This reverses part of `20261023150000_shopping_groups`, which attached a group to a typed
 * **request** (`shopping_extras.group_id`). A group is a property of the **item**, and attaching it
 * to a request cannot say that — so two faults followed, both measured against the real household
 * rather than imagined:
 *
 *   1. **A recipe-derived line could not be grouped at all**, because it has no row. On the week of
 *      2026-10-26 that was 39 of 75 lines. The control would have been absent from half the list.
 *
 *   2. **A line both a recipe and a person ask for appeared twice, with the amount on the wrong
 *      one.** Four such lines that week. Paige wrote "Ground Beef" with no quantity, so her request
 *      contributes nothing to `needed`; filing it under Costco left `beef — BUY 2 lb + 1 lb` in
 *      MEAT & SEAFOOD and a bare `beef` with no amount under COSTCO. One item, two places, the
 *      figure attached to the shop she is not going to.
 *
 * **Standing rather than week-scoped**, which is the one change from `shopping_ticks`'s shape.
 * Ticking is per trip, so a tick belongs to a week. *"We buy beef at Costco"* is a standing fact —
 * week-scoping it would mean refiling 36 items every Monday, and a photographed Costco list would
 * teach the app nothing that outlived the week.
 *
 * `item_key` is the consolidated line's key, the same identity `shopping_ticks` uses and mints in
 * exactly one place (`consolidate`). Nothing else derives one: a route that computed its own would
 * be a second implementation of the thing that decides what merges with what.
 */

create table public.shopping_item_groups (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,

  /*
   * A catalog key like `ground-beef`, or a normalised name for something the catalog does not know.
   * Not a foreign key to anything: the second kind exists only as text somebody typed, which is
   * precisely why `shopping_ticks` stores a key rather than a reference.
   */
  item_key text not null check (length(btrim(item_key)) > 0 and length(item_key) <= 200),

  group_id uuid not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint shopping_item_groups_group foreign key (group_id, family_id)
    references public.shopping_groups (id, family_id) on delete cascade
);

/*
 * One live group per item. Tombstones excluded so ungrouping and regrouping works, which is the
 * same reason `shopping_ticks_one_per_item` is written this way.
 */
create unique index shopping_item_groups_one_per_item
  on public.shopping_item_groups (family_id, item_key)
  where deleted_at is null;

create index shopping_item_groups_family on public.shopping_item_groups (family_id)
  where deleted_at is null;

alter table public.shopping_item_groups enable row level security;

create policy shopping_item_groups_read_in_household on public.shopping_item_groups
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

create policy shopping_item_groups_insert_in_household on public.shopping_item_groups
  for insert to authenticated
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy shopping_item_groups_update_in_household on public.shopping_item_groups
  for update to authenticated
  using (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  )
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

/*
 * Columns, not tables (§26). `item_key` is **not** updatable: moving a row to another key would
 * silently regroup a different item, and the operation a person actually performs is "put this
 * item in that group" — which is `group_id`, or `deleted_at` to take it out of one.
 */
revoke all on public.shopping_item_groups from anon, authenticated;
grant select on public.shopping_item_groups to authenticated;
grant insert (family_id, item_key, group_id) on public.shopping_item_groups to authenticated;
grant update (group_id, deleted_at) on public.shopping_item_groups to authenticated;
grant select, insert, update, delete on public.shopping_item_groups to service_role;

create trigger set_updated_at before update on public.shopping_item_groups
  for each row execute function private.set_updated_at();

/*
 * Deleting a group forgets the assignments rather than keeping rows pointing at a dead label.
 *
 * `tombstone`, not `nullify`, and the difference from `shopping_extras` is the point: an extra is a
 * thing to buy and must survive its label (§91), whereas an assignment *is* the label — with the
 * group gone there is nothing left for the row to say. The item itself is untouched either way,
 * because the item is not stored here at all.
 */
create trigger tombstone_assignments_on_shopping_groups
  after update of deleted_at on public.shopping_groups
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete('shopping_item_groups', 'group_id', 'tombstone');

/*
 * ---------------------------------------------------------------------------
 * The assignment is the only thing that groups a line
 * ---------------------------------------------------------------------------
 *
 * `shopping_extras.group_id` stays, and its meaning narrows to **what was said at the time** — the
 * header a photograph read, the dropdown somebody chose. `buildShoppingWeek` reads it as the
 * fallback when no standing row exists, which makes yesterday's behaviour a special case of this
 * one rather than a parallel system competing with it.
 *
 * Asserted rather than described, because "two sources of truth, one of them authoritative" is the
 * shape that rots: if a later migration ever makes the extras column authoritative again, this
 * fails and names the reason.
 */
create or replace function private.assert_group_lives_on_the_item()
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'shopping_item_groups'
  ) then
    raise exception 'shopping_item_groups is gone: a group belongs to an item, not to one request for it';
  end if;

  if exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'shopping_item_groups'
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) like '%week%'
  ) then
    raise exception 'shopping_item_groups is keyed by week: "we buy beef at Costco" is a standing fact, not a weekly one';
  end if;
end;
$$;

do $do$ begin perform private.assert_group_lives_on_the_item(); end; $do$;
do $do$ begin perform private.assert_rls_invariants(); end; $do$;
