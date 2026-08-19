-- ---------------------------------------------------------------------------
-- Cache the generalisation, because it does not change and browsing does.
--
-- `palateNotes` was a model call on every recipe page view where nothing had been
-- rated. That is the only cost in this project that scales with **reading** rather
-- than importing: a household looking through a dozen recipes paid a dozen times
-- for a sentence about broccoli rabe that is the same sentence every time.
--
-- ---------------------------------------------------------------------------
-- A column, not import_cache and not a memo
-- ---------------------------------------------------------------------------
--
-- `import_cache` is keyed by URL and shared across the whole user base — the right
-- shape for "what does this page say", and the wrong one here. A palate note is per
-- *recipe*, and two households can hold the same URL as different recipes with
-- different edited ingredients.
--
-- A memo dies with the serverless instance. Next.js gives no shared process between
-- requests, so a per-process cache would miss on almost every view and would look
-- like it was working in development.
--
-- So: a column, invalidated by its only input. `palate_key` is a fingerprint of the
-- ingredient lines the note was computed from — recompute when it differs, which is
-- exactly when a person has edited the recipe, and never otherwise. The same shape
-- as EXTRACTOR_VERSION, and the same lesson attached: **a stamp only works if
-- something turns it**, so the key is derived from the input rather than bumped by
-- hand.
-- ---------------------------------------------------------------------------

alter table public.recipes
  add column palate_notes jsonb,
  add column palate_key text;

comment on column public.recipes.palate_notes is
  'Cached general-knowledge notes (§59). Derived, not authored — safe to delete, recomputed on next view.';
comment on column public.recipes.palate_key is
  'Fingerprint of the ingredient lines these notes were computed from. Differs after an edit, which is the only time they need recomputing.';

/*
 * Writable by the household, deliberately.
 *
 * The recipe page computes this with the caller's own client, so `authenticated` needs the
 * grant. That is acceptable here in a way it was not for `classified_at`: this is a cache of a
 * generalisation about food, not a fact about the household or a cursor another job depends on.
 * The worst a client can do is write itself a wrong note about its own recipe, which it can
 * already do by editing the ingredients.
 */
grant insert (palate_notes, palate_key), update (palate_notes, palate_key)
  on public.recipes to authenticated;

do $do$
begin
  if not has_column_privilege('authenticated', 'public.recipes'::regclass, 'palate_notes', 'UPDATE') then
    raise exception 'the recipe page cannot cache what it computed';
  end if;
  if has_column_privilege('anon', 'public.recipes'::regclass, 'palate_notes', 'UPDATE') then
    raise exception 'anon can write palate notes';
  end if;
  -- the matrix has not widened sideways while being added to
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'classified_at', 'UPDATE') then
    raise exception 'a client can re-stamp classified_at';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
