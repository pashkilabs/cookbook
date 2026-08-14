-- Collect the photographs nobody can reach.
--
-- An import stores its photograph before anybody has agreed to save the recipe, because that is
-- when the bytes exist. Every storage read policy resolves through a `photos` row, so until the
-- review is accepted the object is readable by nobody — which is the correct state (090700), and
-- becomes a leak the moment the review is abandoned. The object is then unreachable *and*
-- permanent: nothing points at it, so nothing will ever delete it, and it counts against the
-- bucket forever.
--
-- **§37 made this worse.** Photographs are now stored as fetched rather than resized to 1600px,
-- so a stranded object is megabytes rather than a couple of hundred kilobytes.
--
-- The sweep reuses §35's shape exactly: a predicate, a conditional dispatch, and pg_net calling
-- the app — because **storage objects cannot be deleted with SQL.** `storage.protect_delete()`
-- refuses direct deletes from `storage.objects` to stop objects being orphaned, so removal has to
-- go through the Storage API, which means an HTTP call to something holding the service role.

-- ---------------------------------------------------------------------------
-- One config row now serves two scheduled calls.
--
-- Renamed rather than duplicated: a second table with the same three columns would be a second
-- place for the secret to drift out of step, and this session already spent an afternoon on a
-- shared secret that was set in two places and differed.
-- ---------------------------------------------------------------------------

alter table private.import_drain_config rename to scheduler_config;
alter table private.scheduler_config rename constraint import_drain_config_singleton to scheduler_config_singleton;
alter table private.scheduler_config rename column endpoint to drain_endpoint;
alter table private.scheduler_config add column reaper_endpoint text;

comment on table private.scheduler_config is
  'Where the scheduled jobs POST, and the shared secret they present. One row, both endpoints. Populated by set:drain-endpoint, never by a migration — the secret must not be in git.';

create or replace function private.dispatch_import_drain()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  config private.scheduler_config;
  request_id bigint;
begin
  if not private.import_queue_has_work() then
    return jsonb_build_object('dispatched', false, 'reason', 'idle');
  end if;

  select * into config from private.scheduler_config limit 1;
  if config.drain_endpoint is null then
    return jsonb_build_object('dispatched', false, 'reason', 'not-configured');
  end if;

  select net.http_post(
    url := config.drain_endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pashki-drain-secret', config.secret
    ),
    body := jsonb_build_object('maxJobs', 5),
    timeout_milliseconds := 60000
  ) into request_id;

  return jsonb_build_object('dispatched', true, 'request_id', request_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- What counts as abandoned.
--
-- Three conditions, and the second is the one that makes this safe:
--
--   1. **No `photos` row**, tombstoned or not. A soft-deleted row still describes an object that
--      an undelete would want back (091900), so a tombstone spares the bytes. Row deletion is
--      what releases them, and clients hold no DELETE — so this only ever collects objects that
--      were never claimed at all.
--
--   2. **Not referenced by a live import job.** A job in `queued`, `running` or `review` owns its
--      photograph; a review left open for a week is a person's unfinished work, not litter. This
--      is the precise half of the rule and it does not depend on guessing how long somebody
--      takes.
--
--   3. **Older than the grace window.** The imprecise half, and necessary because the single-URL
--      preview path creates **no job row at all** — `/api/import` stores an object and hands back
--      a draft, so time is the only thing protecting a review in progress there.
--
-- **Twenty-four hours**, which is roughly two orders of magnitude more than a review takes and
-- covers the obvious case of someone opening a review, going to bed, and saving in the morning.
-- The cost of being generous is a few megabytes held one extra day; the cost of being tight is
-- deleting the photograph out from under somebody mid-review, which they would experience as the
-- product losing their work. Asymmetric, so err long.
-- ---------------------------------------------------------------------------

create or replace function private.orphaned_photo_objects(
  p_grace_hours integer default 24
)
returns table (name text, created_at timestamptz, size_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name,
         o.created_at,
         coalesce((o.metadata ->> 'size')::bigint, 0) as size_bytes
  from storage.objects o
  where o.bucket_id = 'recipe-photos'
    and o.created_at < now() - make_interval(hours => p_grace_hours)
    and not exists (
      select 1 from public.photos p where p.storage_path = o.name
    )
    and not exists (
      select 1
      from public.import_jobs j
      where j.deleted_at is null
        and j.status in ('queued', 'running', 'review')
        and j.result_json -> 'photo' ->> 'storagePath' = o.name
    );
$$;

comment on function private.orphaned_photo_objects is
  'Objects in recipe-photos that no photos row claims, no live import job owns, and that are older than the grace window. Unreachable by every policy and billed for regardless.';

create or replace function private.has_orphaned_photo_objects(
  p_grace_hours integer default 24
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from private.orphaned_photo_objects(p_grace_hours));
$$;

/**
 * The sweep, on §35's pattern.
 *
 * An empty bucket-sweep never leaves the database: the predicate runs, finds nothing and returns.
 * Hourly rather than every minute, because nothing here is waiting on a person — an object that
 * has been unreachable for a day can wait another hour.
 */
create or replace function private.dispatch_photo_reaper()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  config private.scheduler_config;
  request_id bigint;
  pending integer;
begin
  select count(*) into pending from private.orphaned_photo_objects();
  if pending = 0 then
    return jsonb_build_object('dispatched', false, 'reason', 'nothing-to-collect');
  end if;

  select * into config from private.scheduler_config limit 1;
  if config.reaper_endpoint is null then
    -- work waiting and nowhere to send it. Reported, because an unconfigured reaper and a clean
    -- bucket must not look the same — that is the whole "silence reads as success" rule.
    return jsonb_build_object('dispatched', false, 'reason', 'not-configured', 'pending', pending);
  end if;

  select net.http_post(
    url := config.reaper_endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pashki-drain-secret', config.secret
    ),
    body := jsonb_build_object('graceHours', 24),
    timeout_milliseconds := 60000
  ) into request_id;

  return jsonb_build_object('dispatched', true, 'request_id', request_id, 'pending', pending);
end;
$fn$;

-- the app needs to ask for the list over PostgREST, and only the service role may
create or replace function public.list_orphaned_photo_objects(p_grace_hours integer default 24)
returns table (name text, created_at timestamptz, size_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.orphaned_photo_objects(p_grace_hours);
$$;

revoke all on function public.list_orphaned_photo_objects(integer) from public;
revoke all on function public.list_orphaned_photo_objects(integer) from anon, authenticated;
grant execute on function public.list_orphaned_photo_objects(integer) to service_role;

do $do$
begin
  perform cron.unschedule('pashki-photo-reaper')
  where exists (select 1 from cron.job where jobname = 'pashki-photo-reaper');

  perform cron.schedule(
    'pashki-photo-reaper',
    '17 * * * *',
    $job$ select private.dispatch_photo_reaper() $job$
  );
end;
$do$;

do $do$
declare
  scheduled integer;
begin
  select count(*) into scheduled from cron.job where jobname = 'pashki-photo-reaper';
  if scheduled <> 1 then
    raise exception 'the reaper is scheduled % times, expected once', scheduled;
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
