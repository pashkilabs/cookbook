#!/bin/bash
# Mutation-test the RLS isolation suite.
#
# For each mutation: weaken policies, run the one test meant to catch it, and
# compare against a stated expectation.
#
# Two things this exposed that are worth keeping in the record:
#
#  1. DROPPING a policy makes a table MORE restrictive, so a negative test
#     ("cannot read another household") still passes. The mutation that proves a
#     negative test has teeth is making the policy PERMISSIVE.
#
#  2. Postgres checks the NEW row of an UPDATE against SELECT policies, not just
#     the UPDATE policy's WITH CHECK. So while the SELECT policy is restrictive it
#     masks the UPDATE policy entirely — weakening UPDATE alone changes nothing.
#     Those mutations are marked `masked`, and the layered mutation below proves
#     the UPDATE policy does work once SELECT is loosened.

cd "$(dirname "$0")/.." || exit 1

PRED="family_id in (select private.current_family_ids())"
SEL_OK="drop policy if exists recipes_select_in_household on public.recipes;
        create policy recipes_select_in_household on public.recipes for select to authenticated using ($PRED);"
UPD_OK="drop policy if exists recipes_update_in_household on public.recipes;
        create policy recipes_update_in_household on public.recipes for update to authenticated using ($PRED) with check ($PRED);"
INS_OK="drop policy if exists recipes_insert_in_household on public.recipes;
        create policy recipes_insert_in_household on public.recipes for insert to authenticated with check ($PRED);"

wrong=0

psql() { docker exec -i supabase_db_db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c "$1" >/dev/null 2>&1; }

# $1 label  $2 expectation (catch|masked)  $3 mutation  $4 restore  $5 test filter
mutate() {
  local label="$1" expect="$2" mutation="$3" restore="$4" filter="$5" outcome
  psql "$mutation" || { printf '%-52s SETUP FAILED\n' "$label"; wrong=$((wrong+1)); return; }

  # confirm the filter selects exactly one test, or the run proves nothing
  local ran
  ran=$(npx vitest run -t "$filter" 2>&1 | grep -oE 'Tests +[0-9]+ (passed|failed)' | head -1)
  if npx vitest run -t "$filter" >/dev/null 2>&1; then outcome=passed; else outcome=failed; fi
  psql "$restore" || printf '            WARNING: restore failed for %s\n' "$label"

  local verdict
  if [ "$expect" = catch ] && [ "$outcome" = failed ]; then verdict="caught (as expected)"
  elif [ "$expect" = masked ] && [ "$outcome" = passed ]; then verdict="masked by SELECT policy (as expected)"
  else verdict="UNEXPECTED: test $outcome, expected to be ${expect/catch/caught}"; wrong=$((wrong+1)); fi
  printf '%-52s %s\n' "$label" "$verdict"
}

printf '%-52s %s\n' "mutation" "outcome"
printf -- '-%.0s' {1..100}; echo

mutate "SELECT permissive" catch \
  "drop policy recipes_select_in_household on public.recipes;
   create policy recipes_select_in_household on public.recipes for select to authenticated using (true);" \
  "$SEL_OK" "even asking for it by id"

mutate "UPDATE using permissive (SELECT intact)" masked \
  "drop policy recipes_update_in_household on public.recipes;
   create policy recipes_update_in_household on public.recipes for update to authenticated using (true) with check ($PRED);" \
  "$UPD_OK" "cannot update another household"

mutate "UPDATE with-check permissive (SELECT intact)" masked \
  "drop policy recipes_update_in_household on public.recipes;
   create policy recipes_update_in_household on public.recipes for update to authenticated using ($PRED) with check (true);" \
  "$UPD_OK" "cannot hand its own recipe"

mutate "SELECT + UPDATE using both permissive" catch \
  "drop policy recipes_select_in_household on public.recipes;
   create policy recipes_select_in_household on public.recipes for select to authenticated using (true);
   drop policy recipes_update_in_household on public.recipes;
   create policy recipes_update_in_household on public.recipes for update to authenticated using (true) with check ($PRED);" \
  "$SEL_OK $UPD_OK" "cannot update another household"

mutate "SELECT + UPDATE with-check both permissive" catch \
  "drop policy recipes_select_in_household on public.recipes;
   create policy recipes_select_in_household on public.recipes for select to authenticated using (true);
   drop policy recipes_update_in_household on public.recipes;
   create policy recipes_update_in_household on public.recipes for update to authenticated using ($PRED) with check (true);" \
  "$SEL_OK $UPD_OK" "cannot hand its own recipe"

mutate "INSERT with-check permissive" catch \
  "drop policy recipes_insert_in_household on public.recipes;
   create policy recipes_insert_in_household on public.recipes for insert to authenticated with check (true);" \
  "$INS_OK" "cannot insert a row into another household"

mutate "RLS switched off on recipes entirely" catch \
  "alter table public.recipes disable row level security;" \
  "alter table public.recipes enable row level security;" \
  "even asking for it by id"

mutate "family_members made writable by clients" catch \
  "grant insert on public.family_members to authenticated;
   create policy fm_insert_test on public.family_members for insert to authenticated with check (true);" \
  "drop policy fm_insert_test on public.family_members;
   revoke insert on public.family_members from authenticated;" \
  "cannot join another household"

mutate "import_cache granted to authenticated" catch \
  "grant select on public.import_cache to authenticated;" \
  "revoke select on public.import_cache from authenticated;" \
  "unreachable by a signed-in client"

printf -- '-%.0s' {1..100}; echo
if [ "$wrong" -eq 0 ]; then
  echo "every mutation behaved as documented"
else
  echo "$wrong mutation(s) did not behave as documented"
fi
[ "$wrong" -eq 0 ] || exit 1
