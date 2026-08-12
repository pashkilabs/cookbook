-- Draining import_jobs.
--
-- The table existed and nothing processed it. A batch import — twenty pasted links —
-- needs a worker, and a worker needs a way to take work that no other worker can also
-- take.

alter table public.import_jobs
  -- how many times this job has been claimed. Distinguishes "never ran" from "keeps
  -- dying", which is the difference between a slow queue and a poison message.
  add column attempts integer not null default 0,
  add column claimed_at timestamptz,
  -- who holds it, for working out which process wedged
  add column worker text,
  -- set once quota has been spent for this job, so a retry does not charge twice
  add column quota_consumed_at timestamptz,
  add column finished_at timestamptz;

-- the queue's own access path: claimable jobs, oldest first
create index import_jobs_queue
  on public.import_jobs (status, created_at)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Claiming work.
--
-- `FOR UPDATE SKIP LOCKED` is the whole mechanism. Two workers running this at the
-- same instant get different rows: the second one steps over the row the first has
-- locked instead of blocking on it or — far worse — reading it, finding it `queued`,
-- and claiming it too. Read-then-write is exactly the race
-- `platform_spend_quota` exists to avoid, and a queue is the same shape.
--
-- A job stuck in `running` is reclaimed once its lease expires. A worker that dies
-- mid-job leaves the row claimed forever otherwise, and one crash would take a job out
-- of circulation permanently. `attempts` is what makes that visible rather than
-- infinite.
-- ---------------------------------------------------------------------------

create or replace function public.import_claim_next_job(
  p_worker text,
  p_lease_seconds integer default 300
)
returns setof public.import_jobs
language sql
volatile
security definer
set search_path = ''
as $$
  update public.import_jobs j
  set status = 'running',
      claimed_at = now(),
      worker = p_worker,
      attempts = j.attempts + 1,
      updated_at = now()
  where j.id = (
    select c.id
    from public.import_jobs c
    where c.deleted_at is null
      and (
        c.status = 'queued'
        -- a lease that has run out: the worker holding it is presumed gone
        or (
          c.status = 'running'
          and c.claimed_at < now() - make_interval(secs => p_lease_seconds)
        )
      )
    order by c.created_at
    for update skip locked
    limit 1
  )
  returning j.*;
$$;

comment on function public.import_claim_next_job is
  'Atomically claim the oldest claimable job, or return no rows. FOR UPDATE SKIP LOCKED means concurrent workers never take the same job. Service role only.';

-- Spending quota and recording that it was spent cannot be one statement, so this at
-- least makes the recording atomic and idempotent: the second call is a no-op.
create or replace function public.import_mark_quota_consumed(p_job_id uuid)
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $$
  update public.import_jobs j
  set quota_consumed_at = coalesce(j.quota_consumed_at, now()),
      updated_at = now()
  where j.id = p_job_id
  returning j.quota_consumed_at;
$$;

comment on function public.import_mark_quota_consumed is
  'Records that quota was spent for a job, once. Idempotent. Service role only.';

-- ---------------------------------------------------------------------------
-- Both functions bypass RLS and decide who gets charged, so only the worker may call
-- them. A client able to claim jobs could take another household's work; a client able
-- to mark quota consumed could import for free.
-- ---------------------------------------------------------------------------

revoke all on function public.import_claim_next_job(text, integer) from public;
revoke all on function public.import_claim_next_job(text, integer) from anon, authenticated;
grant execute on function public.import_claim_next_job(text, integer) to service_role;

revoke all on function public.import_mark_quota_consumed(uuid) from public;
revoke all on function public.import_mark_quota_consumed(uuid) from anon, authenticated;
grant execute on function public.import_mark_quota_consumed(uuid) to service_role;

do $do$
begin
  if has_function_privilege('authenticated', 'public.import_claim_next_job(text, integer)', 'execute')
     or has_function_privilege('anon', 'public.import_claim_next_job(text, integer)', 'execute') then
    raise exception 'a client can claim import jobs, which would let it take another household''s work';
  end if;

  if has_function_privilege('authenticated', 'public.import_mark_quota_consumed(uuid)', 'execute')
     or has_function_privilege('anon', 'public.import_mark_quota_consumed(uuid)', 'execute') then
    raise exception 'a client can mark quota consumed, which would let it import for free';
  end if;

  -- A client keeps ordinary CRUD on its own rows so it can queue a batch and watch it
  -- progress. That it could also fake a finished job is deliberate and harmless: it
  -- gains nothing it could not do by typing a recipe in, and the quota it would dodge
  -- is only spent by the worker on work it never asked for.
  if not has_table_privilege('authenticated', 'public.import_jobs', 'insert') then
    raise exception 'authenticated cannot queue an import job';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
