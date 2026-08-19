-- ---------------------------------------------------------------------------
-- Let a deployment ask whether the database has caught up with it.
--
-- `git push` deploys automatically; `db:push` is remembered by a person. That
-- asymmetry has put code in production ahead of its schema four times — the recipe
-- list, browse, the photo upload path, and /household — and every one surfaced as a
-- server-side exception on a page rather than as anything a deploy would notice.
--
-- A rule that has failed four times against people who know it is not a rule, so
-- `/api/health` now names the migration it is missing and the command that fixes it.
-- Reading `supabase_migrations.schema_migrations` needs this: PostgREST exposes no
-- schema but `public`, and the health route has only HTTP.
--
-- Version strings are not secret — they are filenames in the repository — but this
-- is still service-role only: what the deployment knows about itself is operational,
-- and there is no reason for a stranger to enumerate it.
-- ---------------------------------------------------------------------------

create or replace function public.applied_migration_versions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(version order by version), '{}')
  from supabase_migrations.schema_migrations
$$;

revoke all on function public.applied_migration_versions() from public, anon, authenticated;
grant execute on function public.applied_migration_versions() to service_role;

do $do$
begin
  if has_function_privilege('anon', 'public.applied_migration_versions()', 'execute')
     or has_function_privilege('authenticated', 'public.applied_migration_versions()', 'execute') then
    raise exception 'a client can enumerate applied migrations';
  end if;
  if not has_function_privilege('service_role', 'public.applied_migration_versions()', 'execute') then
    raise exception 'the health route cannot read applied migrations — the grant is missing';
  end if;
  -- it must actually return something, or health reports "unknown" forever
  if array_length(public.applied_migration_versions(), 1) is null then
    raise exception 'applied_migration_versions returned nothing';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
