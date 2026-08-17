-- ---------------------------------------------------------------------------
-- What one named container of an ingredient holds.
--
-- "2 packages dry yeast" is a real line on a real card, and a shopping list has to
-- turn it into something buyable. A packet of dry yeast is 7 g across brands, so
-- that one resolves. A box of cake mix does not: 13.25 oz for Betty Crocker,
-- 15.25 for Duncan Hines, and 18 → 16 → 15 oz over the decades. A default per
-- container *word* would print a confidently wrong weight on exactly the old
-- family recipes this product exists to preserve, so sizes are asserted per
-- ingredient and nowhere else. Where none is known the container stays a
-- container, which is correct and buyable.
--
-- A child table rather than jsonb on `ingredients`, mirroring `grocery_packages`
-- — the same relationship, modelled the same way, because two answers to one
-- question is worse than a join. It also buys guarantees jsonb can only hope for:
-- an amount must be positive, and a word can only mean one thing per ingredient.
-- That matters because this value feeds `toBaseMeasure` and then the shopping
-- list, where a zero or a negative is a silently wrong quantity rather than an
-- error anybody sees.
-- ---------------------------------------------------------------------------

create table public.ingredient_containers (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  -- the written singular: "package", "packet", "can". Plurals and abbreviations are
  -- normalised before they get here, so "pkgs" and "packages" are one row, not three.
  word text not null,
  base_amount numeric not null check (base_amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one ingredient cannot have two different answers for "package". Also what makes
  -- re-seeding an upsert rather than a duplicate.
  constraint ingredient_containers_word_unique unique (ingredient_id, word)
);

create index ingredient_containers_ingredient_id
  on public.ingredient_containers (ingredient_id);

create trigger set_updated_at before update on public.ingredient_containers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges, spelled out.
--
-- Postgres checks table privileges *before* row-level security, so a new table
-- without an explicit grant fails closed while the schema looks correct. And the
-- two environments disagree about what arrives by default: hosted runs
-- ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated, so a
-- new table is born writable by anonymous clients, while the local image grants
-- no DML at all. Every migration here is therefore written against the stricter
-- of the two, and a local green is not evidence the matrix is right — hence the
-- revoke, the explicit grant, and the assertion below.
-- ---------------------------------------------------------------------------

revoke all on public.ingredient_containers from anon, authenticated;
grant select on public.ingredient_containers to authenticated;
grant select, insert, update, delete on public.ingredient_containers to service_role;

alter table public.ingredient_containers enable row level security;

-- the catalog is reference data: readable by every signed-in household, writable by none
create policy ingredient_containers_select_all on public.ingredient_containers
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Self-check: the catalog stays read-only to clients.
--
-- Asserted rather than assumed, because the failure is silent in the safe-looking
-- direction: a permissive default privilege would leave the catalog writable with
-- only RLS between a stranger and it, and nothing in the schema would look wrong.
-- ---------------------------------------------------------------------------

do $do$
begin
  if not has_table_privilege('authenticated', 'public.ingredient_containers', 'select') then
    raise exception 'authenticated cannot read ingredient_containers — the grant is missing';
  end if;

  if not has_table_privilege('service_role', 'public.ingredient_containers', 'insert') then
    raise exception 'service_role cannot seed ingredient_containers — the grant is missing';
  end if;

  declare
    writable text[];
  begin
    select coalesce(array_agg(r.role order by r.role), '{}')
    into writable
    from (values ('anon'), ('authenticated')) as r(role)
    where has_table_privilege(r.role, 'public.ingredient_containers'::regclass, 'insert')
       or has_table_privilege(r.role, 'public.ingredient_containers'::regclass, 'update')
       or has_table_privilege(r.role, 'public.ingredient_containers'::regclass, 'delete');

    if array_length(writable, 1) > 0 then
      raise exception
        'ingredient_containers is reference data and must be read-only to clients, but these roles can write it: %',
        array_to_string(writable, ', ');
    end if;
  end;

  if has_table_privilege('anon', 'public.ingredient_containers', 'select') then
    raise exception 'anon can read ingredient_containers — the catalog is for signed-in households';
  end if;
end;
$do$;
