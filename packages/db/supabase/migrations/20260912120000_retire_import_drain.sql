-- ---------------------------------------------------------------------------
-- The queued batch importer, retired. Schema kept, surface gone.
--
-- **It never delivered a recipe to anyone.** 42 jobs exist in production: 40 belong
-- to the demo household on one day in August and every one is `cancelled` (30) or
-- `failed` (10), all with `error: fetch-failed`. The real household has **zero
-- import jobs, ever** — 58 recipes over 28 days, and not one arrived this way.
-- Stephen confirms he never used it.
--
-- ---------------------------------------------------------------------------
-- Why removed rather than fixed
-- ---------------------------------------------------------------------------
--
-- The evidence says the need is not there. 31 recipes came from a URL one at a
-- time, including the night 29 were captured in one sitting — that evening went
-- through the single-link door 29 times. A door nobody opens while doing precisely
-- the thing it exists for is not blocked; it is unwanted.
--
-- And `fetch-failed` on all ten was never a queue bug. It is the fetcher meeting
-- ten sites at once, and a site that fails one fetch fails a batch too. Bulk import
-- makes the *failure* bulk. The single-link path works because a person watches it
-- and retries, which is the review-screen principle the whole product rests on —
-- and bulk is the one place that principle was absent.
--
-- Three serverless functions recovered, against a host cap of twelve that has
-- already refused a deployment once (§37).
--
-- ---------------------------------------------------------------------------
-- Revoked pending a need, not decided against
-- ---------------------------------------------------------------------------
--
-- `import_jobs`, its policies, its grants, `private.claim_import_jobs` and
-- `packages/import`'s queue and runner all stay. If queued work returns — a share
-- target, a URL worth retrying, a video that takes a minute — the shape is here and
-- tested. What is gone is the standing surface: the route the cron called, the two
-- routes the screen called, the screen, and the chip that opened it.
--
-- `assert_import_drain_retired` fails if the cron job comes back, and is
-- deliberately in the way: restoring it means replacing this assertion in the same
-- migration, so a returning scheduler is something somebody writes down.
--
-- ---------------------------------------------------------------------------
-- PASHKI_DRAIN_SECRET stays, and its name is now wrong
-- ---------------------------------------------------------------------------
--
-- It cannot be retired: `machineCaller` authenticates the **photo reaper** with the
-- same secret, and the reaper is live. This table was already renamed from
-- `import_drain_config` to `scheduler_config` in August for exactly this reason —
-- the codebase noticed the name had outgrown the drain and renamed the table but
-- not the variable.
--
-- Left alone rather than renamed. Renaming it means changing Vercel, this row and
-- the reaper's auth together, with a window where the reaper 401s — and a 401'ing
-- reaper is how photos stopped being collected once already. A wrong name is
-- cheaper than that window, and this comment is where the next reader finds out.
-- ---------------------------------------------------------------------------

do $do$
begin
  -- the reaper's job is untouched: it runs on the same config row and the same secret
  perform cron.unschedule('pashki-import-drain')
  where exists (select 1 from cron.job where jobname = 'pashki-import-drain');
end;
$do$;

-- nothing dispatches to a route that no longer exists
drop function if exists private.dispatch_import_drain();

/*
 * The column has to become nullable before it can be nulled, and the first version of this
 * migration did not notice.
 *
 * `drain_endpoint text not null` since it was created. Locally there is no row at all — the
 * config is populated by `set:drain-endpoint`, which is a hosted operation — so
 * `update ... set drain_endpoint = null` matched **zero rows** and passed. Hosted has the row,
 * and refused: `null value in column "drain_endpoint" violates not-null constraint`.
 *
 * That is the local/hosted blindness in its other direction. The recorded trap is that hosted
 * grants more than local, so a local green proves nothing about privileges; this is the same
 * shape through *data* — an empty table cannot fail a constraint, so a statement that only
 * touches rows is untested wherever the rows are not. The push refused itself and rolled back,
 * which is the outcome to want.
 *
 * Nullable is now correct rather than a concession: there is no drain endpoint, permanently,
 * and a sentinel string would be a URL nothing serves.
 */
alter table private.scheduler_config alter column drain_endpoint drop not null;

update private.scheduler_config set drain_endpoint = null where drain_endpoint is not null;

do $do$
begin
  -- asserted, because the statement above is a no-op wherever there is no row and a silent
  -- no-op is indistinguishable from a success
  if exists (select 1 from private.scheduler_config where drain_endpoint is not null) then
    raise exception 'a drain endpoint is still configured for a route that no longer exists';
  end if;

  -- and the reaper's endpoint must be untouched: they share this row
  if exists (
    select 1 from private.scheduler_config
    where reaper_endpoint is null and drain_endpoint is null
  ) and exists (select 1 from private.scheduler_config) then
    raise warning 'the scheduler row has no endpoints at all — the reaper will not be dispatched until set:drain-endpoint is run';
  end if;
end;
$do$;

comment on column private.scheduler_config.drain_endpoint is
  'Null, and staying null: the batch importer''s drain route is retired (20260912120000). The column is kept because the reaper shares this row, and because a returning queue would use it again.';

create or replace function private.assert_import_drain_retired()
returns void
language plpgsql
as $$
begin
  if exists (select 1 from cron.job where jobname = 'pashki-import-drain') then
    raise exception
      'the import drain is scheduled again but its route is gone — every tick will 404. If queued imports are back, replace this assertion in the migration that restores them';
  end if;

  -- the reaper must NOT have been caught by this: it shares the config row and the secret
  if not exists (select 1 from cron.job where jobname like '%photo%' or jobname like '%reap%') then
    raise exception 'the photo reaper is no longer scheduled — retiring the drain took too much';
  end if;
end;
$$;

-- restated in full: this is one function each migration replaces, and an environment
-- running an older body passes its own checks while missing the newer rule
create or replace function private.assert_rls_invariants()
returns void
language plpgsql
as $outer$
begin
  perform private.assert_household_invariants();
  perform private.assert_soft_delete_propagation();
  perform private.assert_no_anon_reads();
  perform private.assert_photo_storage_policies();
  perform private.assert_source_photos_never_public();
  perform private.assert_birth_year_stays_in_platform();
  perform private.assert_blends_never_public();
  perform private.assert_public_reads_revoked();
  perform private.assert_times_made_is_derived();
  perform private.assert_import_drain_retired();
end;
$outer$;

do $do$
begin
  perform private.assert_rls_invariants();

  -- the schema the feature would need is still here, so this is a revocation and not a deletion
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'import_jobs') then
    raise exception 'import_jobs is gone — this was meant to retire the surface, not the shape';
  end if;
end;
$do$;
