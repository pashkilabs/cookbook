-- Foundations: the private schema, the updated_at trigger, and the one lookup
-- every row-level security policy depends on.
--
-- Sync-readiness without an engine. The sync engine is unresolved
-- (docs/decisions.md §11) and the choice reaches into the schema, so this
-- migration commits only to what every candidate needs:
--
--   * UUID primary keys, so a device can mint an id offline without asking the
--     server for one. gen_random_uuid() is core Postgres from 13 onward, so no
--     extension is required.
--   * created_at and updated_at on every row, updated_at maintained by trigger
--     rather than by application code, because a sync engine writing directly to
--     Postgres never runs our application code.
--   * deleted_at on anything a device can delete, so a deletion is a row a peer
--     can observe rather than an absence it cannot distinguish from "not synced".
--
-- No publications, no replication slots, no engine-specific extensions. Those
-- are engine-shaped and would have to be undone.

create schema if not exists private;

comment on schema private is
  'Helpers that policies depend on. Not exposed through the API — see [api] schemas in config.toml.';

grant usage on schema private to authenticated, service_role;

-- A sync engine replicating straight into Postgres bypasses the application
-- entirely, so updated_at has to be the database's job. Last-write-wins needs a
-- timestamp it can trust.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function private.set_updated_at is
  'Trigger function: stamps updated_at on every UPDATE. Attached to every table carrying the column.';

-- private.current_family_ids() — the lookup every policy depends on — is NOT
-- created here.
--
-- It is LANGUAGE sql, so Postgres parse-analyses its body at creation time, and
-- the family_members table it reads does not exist until the next migration.
-- Creating it here would fail. It lives at the top of the row-level security
-- migration instead, beside the policies that use it.
