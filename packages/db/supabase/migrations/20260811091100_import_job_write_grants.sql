-- A client submits import jobs. It does not run the queue.
--
-- Found by auditing what a client can assert that RLS does not check. RLS checks *which
-- rows* a caller may write; it says nothing about *which columns*, and `authenticated`
-- held table-wide INSERT and UPDATE on `import_jobs`. Every column the worker uses to
-- run the queue was therefore client-assertable.
--
-- Three exploits, all verified against the schema before this migration:
--
-- 1. **Free imports.** The runner charges quota only when `quota_consumed_at is null`
--    (`job-runner.ts`). A client inserting a queued job with `quota_consumed_at` already
--    set gets the work done — a real fetch, a real model call — and is never charged.
--    Quota is the cost lever (decisions §8), and this removed it entirely.
-- 2. **Unlimited re-runs.** Rewinding `status` to 'queued' with `attempts = 0`,
--    `claimed_at = null` re-queues a finished job. Combined with the above, one job can
--    be run forever at no quota cost.
-- 3. **Queue jumping.** `import_claim_next_job` orders by `created_at`. A client
--    back-dating it is served before every other household, indefinitely.
--
-- 090800 did consider client CRUD here and concluded that faking a *finished* job was
-- harmless — "it gains nothing it could not do by typing a recipe in". That reasoning
-- is right about a job that never runs, and it does not cover a job that does: setting
-- `quota_consumed_at` on a job the worker then executes is work we pay for and nobody
-- is charged for. The gap was in the reasoning, not in the policy.
--
-- The fix is column-level grants. A client may create a job and cancel it; every column
-- the queue reasons about belongs to the worker. Column privileges are checked before
-- RLS and are visible in the catalog, which makes this a narrower and more legible
-- guard than a trigger inspecting the caller's role.

revoke insert, update on public.import_jobs from authenticated;

-- `id` is grantable on purpose: UUID keys exist so a device can mint one offline
-- (architecture §5), and a client that cannot supply its own id cannot queue a job
-- while it has no signal.
grant insert (id, family_id, kind, input_ref) on public.import_jobs to authenticated;

-- Cancelling is a tombstone, not a status change. `import_claim_next_job` already
-- skips `deleted_at is not null`, so a cancelled job stops being claimable without the
-- client touching the state machine at all.
grant update (deleted_at) on public.import_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- Self-check.
-- ---------------------------------------------------------------------------

do $do$
declare
  leaked text[];
  -- what only the worker may write. `status` is included: it is the state machine, and
  -- a client moving a job between states is the re-run above.
  worker_owned text[] := array[
    'status', 'result_json', 'error', 'attempts', 'claimed_at', 'worker',
    'quota_consumed_at', 'finished_at', 'created_at', 'updated_at'
  ];
begin
  select coalesce(array_agg(distinct a.attname order by a.attname), '{}')
  into leaked
  from pg_attribute a
  where a.attrelid = 'public.import_jobs'::regclass
    and a.attname = any (worker_owned)
    and (
      has_column_privilege('authenticated', a.attrelid, a.attname, 'INSERT')
      or has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE')
    );

  if array_length(leaked, 1) > 0 then
    raise exception
      'a client can write columns the import queue reasons about, which buys free imports or queue priority: %',
      array_to_string(leaked, ', ');
  end if;

  -- and the converse, or a client cannot queue anything at all
  if not has_column_privilege('authenticated', 'public.import_jobs'::regclass, 'input_ref', 'INSERT') then
    raise exception 'a client cannot submit an import job';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
