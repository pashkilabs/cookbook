-- ---------------------------------------------------------------------------
-- Record the attempt, not just the answer.
--
-- The backfill's resume cursor was `course is null`, which cannot tell "never
-- attempted" from "attempted, and correctly null". A marinade is not a course, so
-- it stays null and was re-classified on every run, forever, at a model call each
-- time — while being counted as work still to do.
--
-- **Same class as the extractor version stamp**, and worth naming as such: a
-- mechanism that infers state from a *result* rather than recording it. There the
-- number existed and nobody turned it; here the state was never written down at
-- all. Both read from the outside as a system quietly doing the wrong thing while
-- reporting normally.
--
-- So `classified_at` is stamped on every attempt whatever the answer, and the
-- cursor becomes `classified_at is null`. A correct null is now a finished recipe.
-- ---------------------------------------------------------------------------

alter table public.recipes add column classified_at timestamptz;

comment on column public.recipes.classified_at is
  'When classification last ran, whatever it concluded. The backfill cursor — a null course is an answer, an unstamped row is unfinished work.';

-- clients do not stamp it: this is the backfill's bookkeeping, written by the
-- service role, and a client able to set it could hide a recipe from the job
revoke insert (classified_at), update (classified_at) on public.recipes from authenticated, anon;

-- Every recipe classified before this column existed is already done. Without the
-- backfill would re-run over all of them on its next pass, paying again for answers
-- it already has.
update public.recipes set classified_at = now() where course is not null and classified_at is null;

-- ---------------------------------------------------------------------------
-- A classification job kind.
--
-- The queue is what this shape belongs in — a long-running batch over a
-- household's recipes is exactly what `import_jobs` exists for — and `kind` is
-- CHECK-constrained, so a new kind is a migration rather than a string.
--
-- `input_ref` stays free for this kind: the existing path constraint applies only
-- to screenshot and video, whose refs are storage paths that must sit under the
-- household's folder. A classify job needs no input beyond its family_id.
-- ---------------------------------------------------------------------------

alter table public.import_jobs drop constraint if exists import_jobs_kind_check;
alter table public.import_jobs
  add constraint import_jobs_kind_check
  check (kind = any (array['url', 'text', 'screenshot', 'video', 'classify']));

do $do$
begin
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'classified_at', 'UPDATE') then
    raise exception 'a client can stamp classified_at and hide a recipe from the backfill';
  end if;

  /*
   * The kind must actually be accepted, or the queue silently has no classify jobs.
   *
   * Asserted against the constraint itself rather than by inserting a row. Two earlier versions
   * tried to insert: the first borrowed a family from public.recipes, which is empty on a fresh
   * local database, so it touched no rows and passed having tested nothing — then failed on
   * hosted where recipes exist. The second fabricated a family and hit NOT NULL on
   * owner_account_id. Both were failing on the wrong constraint entirely.
   *
   * A synthetic row has to satisfy every unrelated invariant on the way to testing one, and each
   * of those is a way for the probe to fail for a reason that is not the thing being probed.
   * Reading the definition cannot behave differently on an empty database, which is the property
   * that matters here (CLAUDE.md — a check that cannot run is not a check).
   */
  if (
    select pg_get_constraintdef(oid) from pg_constraint where conname = 'import_jobs_kind_check'
  ) not like '%classify%' then
    raise exception 'the classify kind is not in import_jobs_kind_check';
  end if;

  if exists (select 1 from public.recipes where course is not null and classified_at is null) then
    raise exception 'already-classified recipes were not stamped, so the backfill will pay for them again';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
