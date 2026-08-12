-- Atomic quota spend, for packages/platform-client.
--
-- A flat subscription against variable AI cost is an unbounded liability, so the
-- quota has to actually hold. Read-then-write in application code does not hold:
-- two devices importing in the same moment both read 499/500 and both write 500,
-- and the household gets one import for free. Worse, that is invisible — the
-- numbers still look plausible afterwards.
--
-- **The period rollover happens here too, in the same statement as the spend.**
-- A nightly reset job would reintroduce exactly the race this function exists to
-- avoid: the job and a spend interleaving over the same row, one of them working
-- from a balance the other has already replaced. Rolling over as part of the spend
-- means there is only ever one writer, and a counter whose period has elapsed is
-- reset by whoever next tries to use it.
--
-- The row is locked with SELECT ... FOR UPDATE, so concurrent callers queue rather
-- than racing. That is what makes "reset then spend" a single indivisible decision.
create or replace function public.platform_spend_quota(
  p_family_id uuid,
  p_app_key text,
  p_quota text,
  p_amount integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  counter jsonb;
  used numeric;
  allowance numeric;
  resets timestamptz;
  resets_text text;
  period_days numeric;
  elapsed_periods numeric;
  rolled boolean := false;
begin
  -- lock the row for the duration; concurrent spends wait here
  select e.quota_json -> p_quota
  into counter
  from public.entitlements e
  where e.family_id = p_family_id
    and e.app_key = p_app_key
  for update;

  -- a counter that does not exist is a refusal, not an implicit allowance
  if counter is null then
    return null;
  end if;

  used := coalesce((counter ->> 'used')::numeric, 0);
  allowance := coalesce((counter ->> 'limit')::numeric, 0);
  resets_text := nullif(counter ->> 'resetsAt', '');
  resets := resets_text::timestamptz;
  period_days := nullif(counter ->> 'periodDays', '')::numeric;

  -- Has the period elapsed? Then this spend starts a fresh one.
  if resets is not null and now() > resets then
    used := 0;
    rolled := true;

    if period_days is not null and period_days > 0 then
      -- advance by whole periods until the deadline is in the future, so a
      -- household that did not import for three months lands on the right date
      -- rather than three resets behind
      elapsed_periods := ceil(
        extract(epoch from (now() - resets)) / (period_days * 86400)
      );
      resets := resets + (elapsed_periods * (period_days || ' days')::interval);
    else
      -- a one-off allowance: it renews once and then never again
      resets := null;
    end if;

    -- match the ISO shape JavaScript writes, so a value that survives a round trip
    -- through this function still compares equal to one that never left
    resets_text := case
      when resets is null then null
      else to_char(resets at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end;
  end if;

  -- Persist the rollover even if the spend is then refused. Time passing is a fact
  -- about the counter, not about this request, and leaving it unrecorded would show
  -- the household a used figure from a period that has ended.
  if rolled then
    counter := jsonb_set(counter, array['used'], to_jsonb(used));
    counter := jsonb_set(
      counter,
      array['resetsAt'],
      case when resets_text is null then 'null'::jsonb else to_jsonb(resets_text) end
    );
    update public.entitlements e
    set quota_json = jsonb_set(e.quota_json, array[p_quota], counter),
        updated_at = now()
    where e.family_id = p_family_id
      and e.app_key = p_app_key;
  end if;

  if used + p_amount > allowance then
    return null;
  end if;

  counter := jsonb_set(counter, array['used'], to_jsonb(used + p_amount));

  update public.entitlements e
  set quota_json = jsonb_set(e.quota_json, array[p_quota], counter),
      updated_at = now()
  where e.family_id = p_family_id
    and e.app_key = p_app_key;

  return counter;
end;
$$;

comment on function public.platform_spend_quota is
  'Atomically roll the period over if it has elapsed, then spend quota, refusing rather than exceeding the limit. Returns the counter after the spend, or null if refused. Service role only.';

-- Functions in public are executable by PUBLIC by default, and this one bypasses
-- RLS. Spending quota is a server decision, so only the service role may call it —
-- a client able to call it directly could spend another household's allowance.
revoke all on function public.platform_spend_quota(uuid, text, text, integer) from public;
revoke all on function public.platform_spend_quota(uuid, text, text, integer) from anon, authenticated;
grant execute on function public.platform_spend_quota(uuid, text, text, integer) to service_role;
