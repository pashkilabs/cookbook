-- Something has to turn the handle.
--
-- `import_jobs` has had an atomic claim, a lease and a runner since Phase 2, and the only caller
-- is a browser with the batch screen open. Close the tab and queued jobs sit there. Decisions §35
-- records the choice; this builds it.
--
-- pg_cron ticks, and calls the route the batch screen already calls. It adds a *caller*, not a
-- second implementation — the drained path stays the one that has been measured, and the claim is
-- untouched. Not a Supabase Edge Function, because the runner stores photographs through sharp, a
-- native Node addon Deno cannot load; not Vercel Cron, because that project is on a plan where
-- cron fires once a day.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Where to call, and with what.
--
-- A table in `private` rather than Supabase Vault: Vault's surface differs between the local
-- image and hosted, and this repo has been bitten twice by trusting the two to agree. A table
-- behaves identically in both, is visible to `check:parity`, and `private` is not a schema
-- PostgREST exposes — so no client can read it whatever grants exist.
--
-- Deliberately empty at migration time. The secret arrives from `pnpm --filter @pashki/db
-- set:drain-endpoint`, which reads it from the environment, so it is never committed.
-- ---------------------------------------------------------------------------

create table private.import_drain_config (
  id boolean primary key default true constraint import_drain_config_singleton check (id),
  endpoint text not null,
  secret text not null,
  updated_at timestamptz not null default now()
);

revoke all on private.import_drain_config from public, anon, authenticated;

comment on table private.import_drain_config is
  'Where the scheduler POSTs to drain the import queue, and the shared secret it presents. One row. Populated by set:drain-endpoint, never by a migration — the secret must not be in git.';

-- ---------------------------------------------------------------------------
-- Is there anything to do?
--
-- The predicate is deliberately the *same one* `import_claim_next_job` selects on, expired leases
-- included. Two things follow, and both are the point rather than a side effect:
--
--   * A job whose worker died is not merely reclaimable in principle — it is what wakes the
--     scheduler. The 300-second lease is exercised by the normal path instead of by an operator
--     noticing something is stuck.
--   * The reclaim cannot rot, because the only thing that triggers a drain is the same condition
--     that makes a claim succeed. If this predicate and the claim ever disagree, the queue either
--     spins on work it cannot take or sleeps on work it could.
-- ---------------------------------------------------------------------------

create or replace function private.import_queue_has_work(
  p_lease_seconds integer default 300
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.import_jobs j
    where j.deleted_at is null
      and (
        j.status = 'queued'
        or (
          j.status = 'running'
          and j.claimed_at < now() - make_interval(secs => p_lease_seconds)
        )
      )
  );
$$;

comment on function private.import_queue_has_work is
  'True when import_claim_next_job would return a row. Must stay in step with that function''s predicate — see 20260811090800.';

-- ---------------------------------------------------------------------------
-- The tick.
--
-- **An idle queue never leaves the database.** A scheduler that POSTs every minute regardless
-- spends 1,440 HTTP calls and 1,440 serverless invocations a day discovering, over and over, that
-- nobody has imported anything — a real bill with no users behind it. Probing first makes an idle
-- minute one indexed lookup on `import_jobs_queue`, an index the claim already needs.
--
-- Returns what it did rather than void, so `cron.job_run_details` records the reason and a quiet
-- queue can be told from a broken one.
-- ---------------------------------------------------------------------------

create or replace function private.dispatch_import_drain()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  config private.import_drain_config;
  request_id bigint;
begin
  if not private.import_queue_has_work() then
    return jsonb_build_object('dispatched', false, 'reason', 'idle');
  end if;

  select * into config from private.import_drain_config limit 1;
  if config.endpoint is null then
    -- Work is waiting and nothing can be done about it. Reported rather than silent: an
    -- unconfigured scheduler and an empty queue must not look the same, or a queue that never
    -- drains reads as a queue with nothing in it.
    return jsonb_build_object('dispatched', false, 'reason', 'not-configured');
  end if;

  select net.http_post(
    url := config.endpoint,
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

comment on function private.dispatch_import_drain is
  'One scheduler tick: drain only if there is claimable work. Returns what it did, so an idle queue and an unconfigured one are distinguishable in cron.job_run_details.';

-- ---------------------------------------------------------------------------
-- Every minute.
--
-- A minute is below the point where somebody watching a batch goes looking for a refresh button,
-- and the batch screen still drains directly while it is open — so this is the fallback for a
-- closed tab, not the primary path. Concurrency and per-household fairness stay out (§31, §35):
-- SKIP LOCKED already permits parallel workers, so adding them later changes the schedule and not
-- the claim.
--
-- Unscheduled first so re-running this migration is idempotent.
-- ---------------------------------------------------------------------------

do $do$
begin
  perform cron.unschedule('pashki-import-drain')
  where exists (select 1 from cron.job where jobname = 'pashki-import-drain');

  perform cron.schedule(
    'pashki-import-drain',
    '* * * * *',
    $job$ select private.dispatch_import_drain() $job$
  );
end;
$do$;

do $do$
declare
  scheduled integer;
begin
  select count(*) into scheduled from cron.job where jobname = 'pashki-import-drain';
  if scheduled <> 1 then
    raise exception 'the drain is scheduled % times, expected once', scheduled;
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
