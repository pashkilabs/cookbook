-- Take the anon read surface back until something renders it.
--
-- 090500 shipped everything a public recipe page needs: `recipes.visibility`, three anon SELECT
-- policies, column grants narrow enough that `select *` fails, and a self-check over the whole
-- surface. **Nothing renders those pages.** The feature was never built.
--
-- That was a fine place to be while the schema sat in a local container. It is a different
-- proposition now: `apps/web` is deployed against a hosted project on the public internet, so the
-- anon read path is reachable by anyone with the publishable key — which is, by design, in every
-- client bundle. The exposure changed; the decision did not.
--
-- The specific hazard is one this repo has already written down. A loosened SELECT policy promotes
-- the UPDATE policy from redundant to load-bearing, because Postgres checks the new row of an
-- UPDATE against SELECT policies. Carrying that promotion for a feature with no users is paying
-- the risk and taking none of the benefit.
--
-- **What is kept, deliberately:**
--
--   * `recipes.visibility` — the column costs nothing, the decision in §17 stands, and dropping it
--     would tombstone whatever anybody has already marked public.
--   * `private.recipe_is_public()` — still used by the `authenticated` cross-household policies.
--   * The `authenticated` `*_select_public_any` policies. Revoking those is a larger change: it
--     restores the SELECT masking that `scripts/mutate-rls.sh` currently proves is gone (§18), so
--     it moves an acceptance criterion rather than a grant. Called out rather than folded in here.
--
-- Rebuilding this is one migration and the text of 090500 is the specification. Decisions §17
-- records the reversal so that rebuilding is a deliberate act.

drop policy if exists recipes_select_public on public.recipes;
drop policy if exists recipe_ingredients_select_public on public.recipe_ingredients;
drop policy if exists photos_select_public on public.photos;

-- The fourth piece, and the one worth noticing: the *storage* read path.
--
-- A public recipe page needs its photograph, so 090700 gave anon a policy on `storage.objects`
-- resolving through `private.photo_object_is_public`. Revoking the table grants without this would
-- have left an anon-readable path to the bytes of every published recipe's photo — invisible from
-- `public`, and exactly the kind of leftover a revocation is supposed to remove. The assertion at
-- the foot of this migration caught it, which is the whole reason it asks about policies in every
-- schema rather than only the three tables above.
--
-- `recipe_photos_read_in_household` stays: it is `authenticated`, and it carries the
-- household read that the app actually uses.
drop policy if exists recipe_photos_read_public on storage.objects;

revoke select on public.recipes from anon;
revoke select on public.recipe_ingredients from anon;
revoke select on public.photos from anon;

-- Granted by 090500 so an anon policy could call `private.recipe_is_public`. Nothing anon does
-- needs the schema now, and a usage grant with no purpose is a foothold for the next mistake.
revoke usage on schema private from anon;

-- ---------------------------------------------------------------------------
-- Assert the surface is gone, positively.
--
-- Revoking is the kind of change that looks done because nothing errored. RLS denies by default,
-- so a *missing* policy and a *revoked* grant produce the same "no rows" from a client — and the
-- point here is that neither remains, not that the effect is currently invisible.
-- ---------------------------------------------------------------------------

do $do$
declare
  offender text;
begin
  select string_agg(format('%s.%s', c.relname, a.attname), ', ')
  into offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relname in ('recipes', 'recipe_ingredients', 'photos')
    and has_column_privilege('anon', c.oid, a.attname, 'SELECT');

  if offender is not null then
    raise exception 'anon can still read %', offender;
  end if;

  select string_agg(p.polname, ', ')
  into offender
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_roles r on r.oid = any(p.polroles)
  where r.rolname = 'anon';

  if offender is not null then
    raise exception 'anon still has policies: %', offender;
  end if;

  if has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'anon still has usage on schema private';
  end if;

  -- and the part that must survive: the column, and the function the authenticated policies use
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.recipes'::regclass and attname = 'visibility' and attnum > 0
  ) then
    raise exception 'recipes.visibility was dropped; §17 stands and only the exposure was reversed';
  end if;

  perform 'private.recipe_is_public(uuid)'::regprocedure;
end;
$do$;

-- ---------------------------------------------------------------------------
-- And make it stick, so the next migration cannot quietly restore it.
--
-- The block above runs once. This runs on every migration that calls the invariants — which is
-- all of them — so a future `grant select ... to anon`, or a policy added to a new table, fails
-- at apply time rather than being discovered on a public host.
--
-- It asks `pg_policy` across every schema on purpose. Scoping it to `public` is precisely the
-- mistake this migration made on its first run: `recipe_photos_read_public` lives in `storage`.
-- ---------------------------------------------------------------------------

create or replace function private.assert_no_anon_reads()
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  offenders text;
begin
  select string_agg(format('%s.%s (%s)', n.nspname, c.relname, p.polname), ', ')
  into offenders
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = any(p.polroles)
  where r.rolname = 'anon';

  if offenders is not null then
    raise exception
      'anon holds read policies, and no public page exists to need them (decisions §17): %',
      offenders;
  end if;

  select string_agg(format('%s.%s', c.relname, a.attname), ', ')
  into offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relkind = 'r'
    and has_column_privilege('anon', c.oid, a.attname, 'SELECT');

  if offenders is not null then
    raise exception 'anon can read %, and no public page exists to need it (decisions §17)', offenders;
  end if;
end;
$fn$;

comment on function private.assert_no_anon_reads is
  'The public read surface is revoked until public recipe pages exist (decisions §17). Fails if anon regains a policy in any schema, or a column grant in public.';

create or replace function private.assert_rls_invariants()
returns void
language plpgsql
set search_path = ''
as $fn$
begin
  perform private.assert_household_invariants();
  perform private.assert_soft_delete_propagation();
  perform private.assert_no_anon_reads();
end;
$fn$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
