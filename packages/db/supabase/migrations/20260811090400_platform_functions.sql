-- Atomic quota spend, for packages/platform-client.
--
-- A flat subscription against variable AI cost is an unbounded liability, so the
-- quota has to actually hold. Read-then-write in application code does not hold:
-- two devices importing in the same moment both read 499/500 and both write 500,
-- and the household gets one import for free. Worse, that is invisible — the
-- numbers still look plausible afterwards.
--
-- A single conditional UPDATE is atomic. The row is locked for the statement, the
-- limit is checked in the WHERE clause, and a refusal is simply zero rows updated.
create or replace function public.platform_spend_quota(
  p_family_id uuid,
  p_app_key text,
  p_quota text,
  p_amount integer
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  update public.entitlements e
  set quota_json = jsonb_set(
        e.quota_json,
        array[p_quota, 'used'],
        to_jsonb(
          coalesce((e.quota_json -> p_quota ->> 'used')::numeric, 0) + p_amount
        )
      ),
      updated_at = now()
  where e.family_id = p_family_id
    and e.app_key = p_app_key
    -- a counter that does not exist is a refusal, not an implicit allowance
    and e.quota_json -> p_quota is not null
    and coalesce((e.quota_json -> p_quota ->> 'used')::numeric, 0) + p_amount
        <= coalesce((e.quota_json -> p_quota ->> 'limit')::numeric, 0)
  returning e.quota_json -> p_quota;
$$;

comment on function public.platform_spend_quota is
  'Atomically spend quota, refusing rather than exceeding the limit. Returns the counter after the spend, or null if refused. Service role only.';

-- Functions in public are executable by PUBLIC by default, and this one bypasses
-- RLS. Spending quota is a server decision, so only the service role may call it —
-- a client able to call it directly could spend another household's allowance.
revoke all on function public.platform_spend_quota(uuid, text, text, integer) from public;
revoke all on function public.platform_spend_quota(uuid, text, text, integer) from anon, authenticated;
grant execute on function public.platform_spend_quota(uuid, text, text, integer) to service_role;
