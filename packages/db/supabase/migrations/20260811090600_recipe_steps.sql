-- Recipe method: ordered steps.
--
-- docs/architecture.md §5 omitted this. The prototype had steps, the Phase 2 detail
-- screen needs them, and Phase 3 cook mode is *entirely* about them.
--
-- A child table, not a text[] on recipes. The join costs a query; the array costs
-- two things that matter more:
--
--   **Sync.** Last-write-wins is per row (decisions §11). With an array, two people
--   editing different steps of the same recipe conflict on one row and one edit is
--   silently lost. With a row per step, last-write-wins resolves each step
--   independently, which is the behaviour that decision assumes is adequate.
--
--   **Cook mode.** Per-step state — a timer, a checked-off box, an ingredient
--   pinned to step 4 — needs a step to have an identity to hang it on. An array
--   element has no id, so every one of those features would begin with this
--   migration anyway.
--
-- No duration or timer column yet: nothing has asked for one, and the point of the
-- table is that adding it later is additive rather than a rewrite. It also matches
-- recipe_ingredients, which is already a child table keyed on position — one shape
-- for both halves of a recipe.

create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  recipe_id uuid not null,
  "position" integer not null,
  -- one instruction. Prose, as the source wrote it.
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint recipe_steps_recipe foreign key (recipe_id, family_id)
    references public.recipes (id, family_id) on delete cascade
);

create index recipe_steps_family_id on public.recipe_steps (family_id);
create index recipe_steps_recipe_id on public.recipe_steps (recipe_id);

create trigger set_updated_at before update on public.recipe_steps
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on public.recipe_steps to authenticated;
grant select, insert, update, delete on public.recipe_steps to service_role;

alter table public.recipe_steps enable row level security;

create policy recipe_steps_select_in_household on public.recipe_steps
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

create policy recipe_steps_insert_in_household on public.recipe_steps
  for insert to authenticated
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy recipe_steps_update_in_household on public.recipe_steps
  for update to authenticated
  using (family_id in (select private.current_family_ids()))
  with check (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

create policy recipe_steps_delete_in_household on public.recipe_steps
  for delete to authenticated
  using (
    family_id in (select private.current_family_ids())
    and private.household_can_write(family_id, 'recipes')
  );

-- ---------------------------------------------------------------------------
-- Steps are NOT public, and that is a copyright position rather than an oversight.
--
-- An ingredient list is close to a list of facts. The method is the blogger's
-- prose — the part decisions §12 says not to reproduce, and the heart of the
-- unresolved copyright question. So a public recipe page shows the ingredients and
-- links back; it does not republish somebody's instructions.
--
-- There is deliberately no anon grant and no anon policy here. Widening is one
-- migration — a column grant and a policy mirroring recipe_ingredients — once the
-- copyright posture is settled, and it should be a deliberate act.
-- ---------------------------------------------------------------------------

do $do$
declare
  privilege text;
begin
  foreach privilege in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('anon', 'public.recipe_steps', privilege) then
      raise exception
        'anon has % on recipe_steps; the method is the source''s prose and is not published',
        privilege;
    end if;
  end loop;
end;
$do$;

-- the invariants, now that there is a new household table to check
do $do$ begin perform private.assert_rls_invariants(); end; $do$;
