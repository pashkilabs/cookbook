-- Give `family_id` back to the UPDATE grant. It was masking the policy that guards it.
--
-- 091300 removed `family_id` from every household table's client UPDATE grant on the
-- reasoning that moving a row between households is not an edit. `pnpm test:mutate`
-- disagreed, and it was right: two mutations that loosen the UPDATE `with check` clause on
-- `recipes` stopped being caught. Their tests — "cannot move its own public recipe into
-- another household" and "cannot hand its own recipe" — passed anyway, because the column
-- privilege refused the write before RLS was consulted.
--
-- That is the masking trap in CLAUDE.md arriving one layer up. It warns that an UPDATE
-- policy can sit redundant behind a restrictive SELECT policy and look tested while
-- nothing exercises it. A column grant masks it exactly the same way, and the harness
-- exists to notice.
--
-- Weigh what the revocation actually bought. RLS already refuses moving a row to another
-- household: `with check (family_id in (select private.current_family_ids()))`, tested and
-- mutation-proven. The only case the column grant added was an account in *two* households
-- moving a row between its own two — which is not an attack and might one day be a
-- feature. So it bought approximately nothing, and cost the visibility of a load-bearing
-- policy.
--
-- `id`, `created_at` and `updated_at` stay revoked: no policy guards those, so nothing is
-- masked, and each is genuinely never a user's decision.

do $do$
declare
  t text;
  household_tables text[] := array[
    'recipes', 'recipe_ingredients', 'recipe_steps', 'ratings', 'meal_plans',
    'plan_entries', 'shortlist_entries', 'pantry_items'
  ];
begin
  foreach t in array household_tables loop
    execute format('grant update (family_id) on public.%I to authenticated', t);
  end loop;
end;
$do$;

-- photos keeps family_id revoked: 091200 narrowed its UPDATE grant to `deleted_at` and
-- `upload_state` because provenance and identity are asserted at ingest, and no RLS
-- policy is masked by that — the storage policies read the row, they do not gate the write.

do $do$
begin
  if not has_column_privilege('authenticated', 'public.recipes'::regclass, 'family_id', 'UPDATE') then
    raise exception
      'family_id is not client-updatable, so the UPDATE policy that refuses a cross-household move is unreachable and its mutation test cannot fail';
  end if;

  -- and the columns that mask nothing stay revoked
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'updated_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.recipes'::regclass, 'id', 'UPDATE') then
    raise exception 'identity and sync timestamps became client-writable again';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
