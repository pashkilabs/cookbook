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
#     the UPDATE policy's WITH CHECK. So while the SELECT policy is household-only it
#     masks the UPDATE policy entirely — weakening UPDATE alone changes nothing.
#     That was recorded here as `masked`, with a note that public recipe pages would
#     promote the UPDATE policy to load-bearing.
#
#     **That has now happened.** A signed-in person can read any household's
#     published recipe, so the UPDATE policy is the only thing stopping a stranger
#     editing one. The two mutations below run against published recipes and are
#     expected to be `caught`. If either reports `masked` again, the UPDATE policy is
#     not guarding and a public recipe is writable by strangers.

cd "$(dirname "$0")/.." || exit 1

# Exit codes are distinguished on purpose:
#   0  every mutation behaved as documented
#   1  at least one NOT CAUGHT — a real regression, some policy is not guarding
#   2  nothing regressed, but at least one mutation COULD NOT BE MEASURED
#
# The third outcome exists because reporting an unusable run as a failure is
# indistinguishable from a policy regression, and a harness that cries wolf gets
# ignored. `db reset` ends by restarting containers, so a run started immediately
# after it can race the API coming back: vitest exits before printing a summary, no
# test matched, and the measurement is worthless rather than bad news.

API_URL="${SUPABASE_API_URL:-http://127.0.0.1:54321}"

# Wait for the REST API, not just the database: the tests talk to PostgREST, and it
# comes back after Postgres does.
await_api() {
  local attempt=0
  until curl -sf -o /dev/null "$API_URL/rest/v1/" -H "apikey: ignored" 2>/dev/null \
     || curl -s -o /dev/null -w '%{http_code}' "$API_URL/rest/v1/" 2>/dev/null | grep -qE '^[24]'; do
    attempt=$((attempt+1))
    if [ "$attempt" -ge 60 ]; then
      echo "the REST API at $API_URL never became ready; is the stack running?" >&2
      return 1
    fi
    sleep 1
  done
  return 0
}

if ! await_api; then exit 2; fi

PRED="family_id in (select private.current_family_ids())"
# writes additionally require a live entitlement; these restore strings must match
# the migration exactly or a restore would quietly leave the table writable after
# grace for every test that runs afterwards
WPRED="$PRED and private.household_can_write(family_id, 'recipes')"
SEL_OK="drop policy if exists recipes_select_in_household on public.recipes;
        create policy recipes_select_in_household on public.recipes for select to authenticated using ($PRED);"
UPD_OK="drop policy if exists recipes_update_in_household on public.recipes;
        create policy recipes_update_in_household on public.recipes for update to authenticated using ($PRED) with check ($WPRED);"
INS_OK="drop policy if exists recipes_insert_in_household on public.recipes;
        create policy recipes_insert_in_household on public.recipes for insert to authenticated with check ($WPRED);"

regressions=0
unmeasured=0

psql() { docker exec -i supabase_db_db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c "$1" >/dev/null 2>&1; }

# $1 label  $2 expectation (catch|masked)  $3 mutation  $4 restore  $5 test filter
#
# Note on filters: vitest -t matches the full test name with describe blocks joined
# by a SPACE, not by " > ". A filter that matches nothing runs zero tests and exits
# 0, which would read as "the mutation was not caught" — so the match count is
# asserted before the outcome is believed. The harness must not be able to lie.
# Run the filtered test once and report how many tests matched and how many failed,
# as "<matched> <failed>". Matched 0 means the measurement is worthless.
measure() {
  local filter="$1" out tests_line passed failed
  out=$(npx vitest run -t "$filter" 2>&1)
  tests_line=$(grep -E '^ *Tests ' <<<"$out" | head -1)
  passed=$(grep -oE '[0-9]+ passed' <<<"$tests_line" | grep -oE '[0-9]+' | head -1)
  failed=$(grep -oE '[0-9]+ failed' <<<"$tests_line" | grep -oE '[0-9]+' | head -1)
  passed=${passed:-0}; failed=${failed:-0}
  echo "$((passed + failed)) $failed"
}

mutate() {
  local label="$1" expect="$2" mutation="$3" restore="$4" filter="$5"
  if ! psql "$mutation"; then
    printf '%-52s COULD NOT MEASURE (mutation SQL failed)\n' "$label"
    unmeasured=$((unmeasured+1))
    return
  fi

  local result matched failed
  read -r matched failed <<<"$(measure "$filter")"

  # A run that matched nothing is usually the API still coming back after a restart.
  # Retry once, after waiting: a filter that genuinely matches nothing fails twice and
  # is still reported as unmeasurable, so the retry cannot hide a wrong filter.
  if [ "$matched" -eq 0 ]; then
    await_api || true
    read -r matched failed <<<"$(measure "$filter")"
  fi

  psql "$restore" || printf '            WARNING: restore failed for %s\n' "$label"

  if [ "$matched" -ne 1 ]; then
    printf '%-52s COULD NOT MEASURE (%s tests matched) — filter: %s\n' "$label" "$matched" "$filter"
    unmeasured=$((unmeasured+1))
    return
  fi

  local outcome
  if [ "$failed" -gt 0 ]; then outcome=failed; else outcome=passed; fi

  if [ "$expect" = catch ] && [ "$outcome" = failed ]; then
    printf '%-52s caught (as expected)\n' "$label"
  elif [ "$expect" = masked ] && [ "$outcome" = passed ]; then
    printf '%-52s masked by SELECT policy (as expected)\n' "$label"
  else
    printf '%-52s NOT CAUGHT — test %s, expected to be %s\n' \
      "$label" "$outcome" "${expect/catch/caught}"
    regressions=$((regressions+1))
  fi
}

# ---------------------------------------------------------------------------
# Mutations whose guard is a schema invariant, not a test.
#
# Some weakenings are invisible to any client. Granting anon a column with no policy
# behind it exposes nothing — RLS denies by default — so no test can catch it, and a
# harness that only ran tests would report the hole as "masked" and move on. That is
# the harness going quiet, which is the failure this whole script exists to prevent.
#
# `private.assert_no_anon_reads()` is the guard for those, and it runs on every future
# migration. This proves it actually raises, by making the change and asserting the
# invariant refuses it.
# ---------------------------------------------------------------------------
psql_raises() {
  # succeeds when the statement FAILS, which is the whole point
  ! docker exec -i supabase_db_db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
      -c "$1" >/dev/null 2>&1
}

invariant_catches() {
  local label="$1" mutation="$2" restore="$3"
  if ! psql "$mutation"; then
    printf '%-52s COULD NOT MEASURE (mutation SQL failed)\n' "$label"
    unmeasured=$((unmeasured+1))
    return
  fi

  if psql_raises "do \$do\$ begin perform private.assert_rls_invariants(); end; \$do\$;"; then
    printf '%-52s caught by the invariant (as expected)\n' "$label"
  else
    printf '%-52s NOT CAUGHT — the invariant accepted it\n' "$label"
    regressions=$((regressions+1))
  fi

  psql "$restore" || printf '            WARNING: restore failed for %s\n' "$label"
}

printf '%-52s %s\n' "mutation" "outcome"
printf -- '-%.0s' {1..100}; echo

mutate "SELECT permissive" catch \
  "drop policy recipes_select_in_household on public.recipes;
   create policy recipes_select_in_household on public.recipes for select to authenticated using (true);" \
  "$SEL_OK" "even asking for it by id"

mutate "UPDATE using permissive, on a published recipe" catch \
  "drop policy recipes_update_in_household on public.recipes;
   create policy recipes_update_in_household on public.recipes for update to authenticated using (true) with check ($WPRED);" \
  "$UPD_OK" "cannot update another household's public recipe"

mutate "UPDATE with-check permissive, on a published recipe" catch \
  "drop policy recipes_update_in_household on public.recipes;
   create policy recipes_update_in_household on public.recipes for update to authenticated using ($PRED) with check (true);" \
  "$UPD_OK" "cannot move its own public recipe into another household"

mutate "SELECT + UPDATE using both permissive (unpublished)" catch \
  "drop policy recipes_select_in_household on public.recipes;
   create policy recipes_select_in_household on public.recipes for select to authenticated using (true);
   drop policy recipes_update_in_household on public.recipes;
   create policy recipes_update_in_household on public.recipes for update to authenticated using (true) with check ($WPRED);" \
  "$SEL_OK $UPD_OK" "cannot update another household's recipe"

mutate "SELECT + UPDATE with-check both permissive (unpublished)" catch \
  "drop policy recipes_select_in_household on public.recipes;
   create policy recipes_select_in_household on public.recipes for select to authenticated using (true);
   drop policy recipes_update_in_household on public.recipes;
   create policy recipes_update_in_household on public.recipes for update to authenticated using ($PRED) with check (true);" \
  "$SEL_OK $UPD_OK" "cannot hand its own recipe"

mutate "INSERT with-check permissive" catch \
  "drop policy recipes_insert_in_household on public.recipes;
   create policy recipes_insert_in_household on public.recipes for insert to authenticated with check (private.household_can_write(family_id, 'recipes'));" \
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


mutate "entitlement check dropped from INSERT policy" catch \
  "drop policy recipes_insert_in_household on public.recipes;
   create policy recipes_insert_in_household on public.recipes for insert to authenticated with check ($PRED);" \
  "$INS_OK" "read-only after grace cannot insert"

# The public read surface is revoked (decisions §17, migration 20260814090000), so the two
# mutations that used to live here — loosening the anon policy, and granting anon the household
# column — no longer test anything. Neither exposes a row on its own: a grant with no policy is
# denied by RLS, and a policy with no column grant cannot name a column. Left as one mutation
# that restores *both* halves, because both together is what the revocation removed and what a
# future migration might restore by accident.
mutate "anon given back the public read surface" catch \
  "grant select on public.recipes to anon;
   create policy recipes_select_public on public.recipes for select to anon using (true);" \
  "drop policy recipes_select_public on public.recipes;
   revoke select on public.recipes from anon;" \
  "refuses a published recipe to anon"

# The half a client cannot see. A column grant with no policy leaks nothing today, and
# is exactly how the surface would grow back one migration at a time.
invariant_catches "anon re-granted a column, with no policy" \
  "grant select (title) on public.recipes to anon;" \
  "revoke select on public.recipes from anon;"

invariant_catches "anon given a policy on storage.objects" \
  "create policy anon_probe on storage.objects for select to anon using (true);" \
  "drop policy if exists anon_probe on storage.objects;"

printf -- '-%.0s' {1..100}; echo

if [ "$regressions" -gt 0 ]; then
  echo "$regressions mutation(s) NOT CAUGHT — a policy is not guarding what a test claims"
  [ "$unmeasured" -eq 0 ] || echo "$unmeasured also could not be measured"
  exit 1
fi

if [ "$unmeasured" -gt 0 ]; then
  echo "no regressions, but $unmeasured mutation(s) could not be measured — re-run before trusting this"
  exit 2
fi

echo "every mutation behaved as documented"
