-- Which measurement system a household reads.
--
-- The shopping list was showing a household its own recipes back in the wrong units: somebody
-- typing "300 g tagliatelle" got "11 oz", because `formatWeight` is imperial above 25 g and the
-- catalog's packages are American. Neither the input nor the catalog is the right authority —
-- **the household is** (decisions §28). A household that types metric on Monday and imperial on
-- Thursday should still read one consistent list.
--
-- `families` is a platform table, so this is read-only to clients and set through the seam. It
-- defaults to `us`, which is what every existing household has effectively been.

alter table public.families
  add column measurement_system text not null default 'us'
    check (measurement_system in ('us', 'metric'));

comment on column public.families.measurement_system is
  'Which units this household reads. Display follows the household, not the recipe it typed or the catalog it is shopping from (decisions §28).';

-- ---------------------------------------------------------------------------
-- Package sizes are per market, because the sizes themselves differ.
-- ---------------------------------------------------------------------------
--
-- A pint is 473 ml and a metric carton is 500. So this is not one row with two labels: it is two
-- rows, and a shopping list must never mix them — `choosePackages` would otherwise suggest a pint
-- and a 500 ml carton for the same purchase.

alter table public.grocery_packages
  add column system text not null default 'us'
    check (system in ('us', 'metric'));

-- the uniqueness that made a package identifiable now includes the market
alter table public.grocery_packages
  drop constraint grocery_packages_label_unique,
  add constraint grocery_packages_label_unique unique (ingredient_id, system, label);

create index grocery_packages_by_system on public.grocery_packages (ingredient_id, system);

do $do$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'families' and column_name = 'measurement_system'
  ) then
    raise exception 'families has no measurement system, so display has no authority to follow';
  end if;

  -- clients read the preference and do not set it: platform tables are read-only to them
  -- (decisions §16), and the seam is what changes a household's settings
  if has_column_privilege('authenticated', 'public.families'::regclass, 'measurement_system', 'UPDATE')
     or has_column_privilege('anon', 'public.families'::regclass, 'measurement_system', 'UPDATE') then
    raise exception 'a client can set its own measurement system directly, bypassing the seam';
  end if;

  if not has_column_privilege('authenticated', 'public.families'::regclass, 'measurement_system', 'SELECT') then
    raise exception 'a client cannot read the preference it is meant to be shown in';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
