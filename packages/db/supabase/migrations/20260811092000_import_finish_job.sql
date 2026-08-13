-- Recording a job's outcome and paying for it are one statement.
--
-- The runner used to spend quota *before* fetching, on the reasoning that the request is the
-- cost. Measured against a deliberately messy batch of twenty-two pasted links, that reasoning
-- lost: fifteen reached the queue and ten failed to fetch — link rot, bot-blocking CDNs, a
-- paywall — so two thirds of the household's allowance bought nothing. Somebody who pastes
-- twenty saved links, gets five recipes and is billed for fifteen experiences that as the
-- product being broken, and they are not wrong. Decisions §32 keeps the old argument and the
-- reason it was reversed.
--
-- So: charge when the result is recorded, and only when there is a result worth charging for.
--
-- **In one statement, which is the whole point of putting it here.** Spending and then recording
-- would leave a window where a crash charges a household for a job that still looks unfinished;
-- recording and then spending leaves the opposite. A refund path would close neither — it would
-- add a second write that can itself fail, and a refund racing a concurrent spend is exactly the
-- read-then-write `platform_spend_quota` exists to avoid. One function, one transaction, no
-- refunds.
--
-- `quota_consumed_at` is what makes it idempotent: a job re-claimed after its lease expired and
-- finished twice pays once, because the second call sees the stamp and skips the spend.

create or replace function public.import_finish_job(
  p_job_id uuid,
  p_status text,
  p_result jsonb,
  p_error text,
  p_app_key text,
  p_quota text,
  -- the caller's judgement about whether this outcome cost anything. False for a cache hit: a
  -- recipe already extracted for another household is handed over free (architecture §11).
  p_charge boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_family uuid;
  v_consumed timestamptz;
  v_status text := p_status;
  v_result jsonb := p_result;
  v_error text := p_error;
  v_charged boolean := false;
  v_refusal text;
  v_spent jsonb;
begin
  if p_status not in ('review', 'failed') then
    raise exception 'a job finishes in review or failed, not %', p_status;
  end if;

  -- lock the job for the duration: a concurrent finish of the same row waits here rather than
  -- both reading a null quota_consumed_at and both charging
  select j.family_id, j.quota_consumed_at
  into v_family, v_consumed
  from public.import_jobs j
  where j.id = p_job_id
  for update;

  if v_family is null then
    raise exception 'no import job %', p_job_id;
  end if;

  if p_status = 'review' and p_charge and v_consumed is null then
    -- A counter that does not exist is a refusal, not an implicit allowance, and it is a
    -- different sentence to show somebody: "this household has no allowance" rather than "you
    -- have used this month's". platform_spend_quota returns null for both, so the distinction
    -- is drawn here.
    if not exists (
      select 1 from public.entitlements e
      where e.family_id = v_family and e.app_key = p_app_key
    ) then
      v_refusal := 'no-entitlement';
    else
      v_spent := public.platform_spend_quota(v_family, p_app_key, p_quota, 1);
      if v_spent is null then
        v_refusal := 'exceeded';
      else
        v_charged := true;
      end if;
    end if;

    if v_refusal is not null then
      /*
       * The extraction succeeded and cannot be paid for.
       *
       * Recorded as failed rather than handed over free: a review that costs nothing is an
       * unmetered import, and the meter is the only thing standing between an allowance and
       * ignoring it. The household is told which of the two refusals it was.
       *
       * The cost of charging late is visible right here — the page was already fetched before
       * anyone asked whether it could be paid for. That is the trade accepted in §32.
       */
      v_status := 'failed';
      v_result := jsonb_build_object(
        'ok', false,
        'failure', jsonb_build_object('kind', 'quota-exceeded', 'reason', v_refusal)
      );
      v_error := 'quota ' || v_refusal;
    end if;
  end if;

  update public.import_jobs j
  set status = v_status,
      result_json = v_result,
      error = v_error,
      quota_consumed_at = case when v_charged then now() else j.quota_consumed_at end,
      finished_at = now(),
      updated_at = now()
  where j.id = p_job_id;

  return jsonb_build_object(
    'recorded', v_status,
    'charged', v_charged,
    'quota', v_refusal
  );
end;
$$;

comment on function public.import_finish_job is
  'Record a job outcome and, for a chargeable success, spend one import in the same transaction. Returns {recorded, charged, quota}. Service role only.';

-- Bypasses RLS and spends an allowance, so the same rule as platform_spend_quota: a client able
-- to call this could finish another household''s job and spend its quota.
revoke all on function public.import_finish_job(uuid, text, jsonb, text, text, text, boolean) from public;
revoke all on function public.import_finish_job(uuid, text, jsonb, text, text, text, boolean) from anon, authenticated;
grant execute on function public.import_finish_job(uuid, text, jsonb, text, text, text, boolean) to service_role;

-- Superseded. Stamping the consumption separately is precisely the two-statement shape the
-- function above exists to remove, and leaving it callable leaves a second way to do the thing
-- that must only happen one way.
drop function if exists public.import_mark_quota_consumed(uuid);

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
