-- The parity check's question set.
--
-- One row per check, `key|value`, so the comparison is a string diff rather than a
-- judgement. Anything environment-specific (row counts of user data, timestamps) is
-- deliberately absent: this asks whether the *schema and its privileges* match, not
-- whether the data does.
--
-- Kept as SQL rather than built in JavaScript so the two environments are asked a
-- byte-identical question. Output formatting is set by the runner's psql flags rather
-- than by `\pset` here, because psql echoes a confirmation line for each `\pset` and
-- that line parses as an answer.

select 'tables', count(*)::text from pg_tables where schemaname = 'public';

select 'policies', count(*)::text
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public';

select 'storage_policies', count(*)::text
from pg_policy where polrelid = 'storage.objects'::regclass;

select 'private_functions', count(*)::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private';

select 'ingredients', count(*)::text from public.ingredients;
select 'grocery_packages', count(*)::text from public.grocery_packages;

select 'bucket_recipe_photos', coalesce(
  (select id || ' public=' || public::text from storage.buckets where id = 'recipe-photos'),
  'MISSING');

select 'composite_foreign_keys', count(*)::text
from pg_constraint where contype = 'f' and array_length(conkey, 1) = 2;

-- The shared tables. `import_cache` belongs to nobody; the catalog and the platform
-- tables are read-only to clients. This is the check that a permissive default privilege
-- breaks, and the reason this script exists.
select 'import_cache_client_readable',
  (has_table_privilege('anon', 'public.import_cache', 'SELECT')
   or has_table_privilege('authenticated', 'public.import_cache', 'SELECT'))::text;

select 'shared_tables_client_writable', coalesce(
  string_agg(c.relname || ':' || r.rolname, ',' order by c.relname, r.rolname), 'none')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
where c.relkind = 'r'
  and c.relname in (
    'accounts', 'families', 'family_members', 'devices', 'subscriptions',
    'entitlements', 'ingredients', 'grocery_packages', 'import_cache'
  )
  and (
    has_table_privilege(r.rolname, c.oid, 'INSERT')
    or has_table_privilege(r.rolname, c.oid, 'UPDATE')
    or has_table_privilege(r.rolname, c.oid, 'DELETE')
  );

select 'anon_write_grants', count(*)::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relkind = 'r'
  and (
    has_table_privilege('anon', c.oid, 'INSERT')
    or has_table_privilege('anon', c.oid, 'UPDATE')
    or has_table_privilege('anon', c.oid, 'DELETE')
  );

-- Client write privileges, per table and column. Reported as a count and a digest: the
-- full list is seventy-odd entries and unreadable in a diff, while a digest changes if
-- any single grant widens. `check-parity.mjs --verbose` prints the list itself.
select 'client_write_columns',
  count(*)::text || ' cols md5=' || coalesce(md5(string_agg(entry, ',' order by entry)), 'none')
from (
  select distinct c.relname || '.' || a.attname as entry
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relkind = 'r'
    and (
      has_column_privilege('authenticated', c.oid, a.attname, 'INSERT')
      or has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE')
    )
) as columns;

-- The list behind that digest, for when it differs. Long by nature.
select 'client_write_columns_detail', coalesce(string_agg(entry, ',' order by entry), 'none')
from (
  select distinct c.relname || '.' || a.attname as entry
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relkind = 'r'
    and (
      has_column_privilege('authenticated', c.oid, a.attname, 'INSERT')
      or has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE')
    )
) as columns;

select 'tables_with_rls_disabled', coalesce(
  string_agg(c.relname, ',' order by c.relname), 'none')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relkind = 'r' and not c.relrowsecurity;

select 'migrations_applied', coalesce(
  (select count(*)::text from supabase_migrations.schema_migrations), 'no history table');

-- `private.assert_rls_invariants()` is deliberately NOT called here. It raises, and
-- ON_ERROR_STOP would abandon the whole question set — so one broken invariant in one
-- environment would be reported as "could not measure the comparison" rather than as the
-- specific failure it is. The runner asks each environment separately.
