/*
 * ---------------------------------------------------------------------------
 * Groups a household makes — Costco, HEB, Trader Joes, Boo Basket
 * ---------------------------------------------------------------------------
 *
 * This reverses the free-text decision in `docs/shopping-additions.md`, and the reasoning that
 * reversed it is worth keeping. I argued a sections table needed an identity nothing could answer:
 * *is this photograph's COSTCO the same COSTCO?* The answer is that **a group exists because
 * somebody made it** — identity comes from the household creating it, not from matching strings,
 * and a photographed header then *matches* an existing group rather than defining one.
 *
 * Which also settles what free text could not: no duplicates from a misspelling, renaming does not
 * orphan anything, and a label can be deleted without deleting the things to buy.
 *
 * **Not called a store.** Her third header is "Boo Basket" — a Halloween gift basket. A `store`
 * column would either drop that group or lie about it.
 */

create table public.shopping_groups (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,

  /* as they wrote it: "Trader Joes" stays "Trader Joes" and is never corrected to "Trader Joe's" */
  name text not null check (length(btrim(name)) > 0 and length(name) <= 60),

  /*
   * Who made it — and **nullable**, unlike `shopping_extras.added_by`, which the invariant chain
   * is what made me think about properly.
   *
   * A group is the **household's**, not the person's. When a member is removed, their requests go
   * with them (an extra is a thing *they* asked for) but Costco does not — the household still
   * shops there. So the propagation below is `nullify`: forget who made it, keep the group. That
   * mode exists for exactly this and requires the column to permit null.
   *
   * The route always supplies it, so "unattributed at insert" is not reachable through the
   * product; what this permits is a group whose maker has since left, which is a true state. Same
   * shape as §88's `changed_by`: the household outlives the login.
   */
  created_by uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint shopping_groups_member foreign key (created_by, family_id)
    references public.family_members (id, family_id) on delete cascade,

  /*
   * The composite key a child's foreign key needs, the same one `family_members_id_family_id`
   * exists for: `assert_household_invariants` demands that a reference between household tables
   * carry `family_id`, or a child can claim a household its parent is not in — and Postgres will
   * not accept such a reference without a unique constraint to match it.
   */
  constraint shopping_groups_id_family_id unique (id, family_id)
);

/*
 * ---------------------------------------------------------------------------
 * Case and punctuation are not a fuzzy-matching problem
 * ---------------------------------------------------------------------------
 *
 * "COSTCO", "Costco" and "costco" are one group and must never reach a matcher at all — a
 * threshold is for "Trader Joe's" against "Trader Joes", not for a capital letter. So the
 * normalised form is unique per household, enforced here rather than hoped for in a route.
 *
 * Trailing `s` goes too, which folds "Costcos" into "Costco". That is a deliberate over-reach on a
 * label people write casually; the cost of folding two groups somebody meant to keep apart by a
 * plural alone is lower than the cost of a duplicate group they have to notice and merge.
 */
create or replace function private.normalise_group_name(name text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(lower(btrim(coalesce(name, ''))), '[^a-z0-9]', '', 'g'),
    's$', ''
  );
$$;

create unique index shopping_groups_one_per_name
  on public.shopping_groups (family_id, private.normalise_group_name(name))
  where deleted_at is null;

create index shopping_groups_household on public.shopping_groups (family_id)
  where deleted_at is null;

comment on table public.shopping_groups is
  'Groups a household creates for its shopping — a shop, or a gift basket. Not a store: "Boo Basket" is a real group and a store column would lie about it. A photographed header matches one of these rather than creating one (§91).';

alter table public.shopping_groups enable row level security;

create policy shopping_groups_select_in_household on public.shopping_groups
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

create policy shopping_groups_insert_in_household on public.shopping_groups
  for insert to authenticated
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy shopping_groups_update_in_household on public.shopping_groups
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
 * Columns, not tables (§26). `name` is updatable because **renaming is the point** — it is what the
 * table buys over free text, and it must not orphan an item. `created_by` is not: who made a group
 * is not editable after the fact.
 */
revoke all on public.shopping_groups from anon, authenticated;
grant select on public.shopping_groups to authenticated;
grant insert (family_id, name, created_by) on public.shopping_groups to authenticated;
grant update (name, deleted_at) on public.shopping_groups to authenticated;
grant select, insert, update, delete on public.shopping_groups to service_role;

create trigger set_updated_at before update on public.shopping_groups
  for each row execute function private.set_updated_at();

/*
 * ---------------------------------------------------------------------------
 * The group on an extra, and what happens when a group goes away
 * ---------------------------------------------------------------------------
 *
 * Nullable, because most items have no group and always will: a recipe-derived item has no opinion
 * about where to buy it, and a typed one need not say.
 *
 * **Deleting a label must never delete a thing to buy.** `ON DELETE SET NULL` says that for a hard
 * delete, and the `nullify` propagation below says it for a soft one — the mode exists already,
 * written for exactly this shape: *"removing a person must not remove the household's recipes, it
 * must forget who wrote them"*. An item in a deleted group loses the group and stays on the list.
 */
alter table public.shopping_extras
  add column if not exists group_id uuid;

alter table public.shopping_extras
  add constraint shopping_extras_group foreign key (group_id, family_id)
    references public.shopping_groups (id, family_id) on delete set null;

create index shopping_extras_group on public.shopping_extras (group_id)
  where deleted_at is null;

grant insert (group_id) on public.shopping_extras to authenticated;
grant update (group_id) on public.shopping_extras to authenticated;

/*
 * A removed member keeps their groups for the household: forget the maker, keep Costco.
 */
create trigger nullify_maker_on_shopping_groups
  after update of deleted_at on public.family_members
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete('shopping_groups', 'created_by', 'nullify');

create trigger nullify_group_on_shopping_extras
  after update of deleted_at on public.shopping_groups
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.propagate_soft_delete('shopping_extras', 'group_id', 'nullify');

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
