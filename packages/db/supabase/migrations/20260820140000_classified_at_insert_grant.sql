-- ---------------------------------------------------------------------------
-- A client may stamp `classified_at` when it creates a recipe, and never after.
--
-- 20260819090000 revoked both INSERT and UPDATE, reasoning that a client able to
-- stamp a recipe could hide it from the backfill. That is right about UPDATE and
-- wrong about INSERT: **saving an imported recipe genuinely is an attempt**. The
-- extraction filled course, cuisine, dish_form and principal_protein, and a row
-- carrying those with a null stamp says "classified" and "never attempted" at once
-- — the exact incoherence the column exists to prevent.
--
-- The revocation and the write shipped in different commits and met in production:
-- every recipe creation returned 403, caught by smoke rather than by anything local,
-- because a local database is seeded and a local test signs in as the service role.
--
-- So INSERT is granted and UPDATE stays revoked. A household can record that a
-- recipe was classified as it saves it; it cannot reach back and stamp an older one
-- to make the backfill skip it. The asymmetry is the point: creation is an event a
-- client is party to, and re-stamping is bookkeeping it has no business in.
-- ---------------------------------------------------------------------------

grant insert (classified_at) on public.recipes to authenticated;

do $do$
begin
  if not has_column_privilege('authenticated', 'public.recipes'::regclass, 'classified_at', 'INSERT') then
    raise exception 'a household cannot record that a recipe it saved was classified';
  end if;

  -- the half that must stay shut
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'classified_at', 'UPDATE') then
    raise exception 'a client can re-stamp classified_at and hide a recipe from the backfill';
  end if;

  if has_column_privilege('anon', 'public.recipes'::regclass, 'classified_at', 'INSERT') then
    raise exception 'anon can write classified_at';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
