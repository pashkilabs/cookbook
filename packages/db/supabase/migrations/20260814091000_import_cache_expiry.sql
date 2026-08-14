-- A cached extraction that a parser fix cannot reach.
--
-- `import_cache` holds one row per URL for the whole user base, and nothing has ever expired.
-- `fetched_at` was written and read by nothing; `refresh` exists in `ImportOptions` and no caller
-- passes it. So a bad parse is served to every household that imports that link, forever.
--
-- That is not hypothetical. The tier-0 extractor has been corrected twice — once for image
-- references, where a bare `{"@id": ...}` overwrote the real node it pointed at, and once for
-- fetching the normalised cache key instead of the URL as written. Both times the fix reached new
-- imports and nothing else, and nothing reported the difference.
--
-- The column is the half of the fix that lives in the schema. `packages/import/src/cache-policy.ts`
-- holds the reasoning and the other half: a version stamp for "the parser moved", an age for "the
-- page might have", because neither covers the other.
--
-- **Default 0, deliberately.** Every existing row was written by an extractor older than the
-- corrections above, so it should be treated as stale rather than grandfathered in. Backfilling
-- to the current version would preserve exactly the entries this exists to invalidate.

alter table public.import_cache
  add column extractor_version integer not null default 0;

comment on column public.import_cache.extractor_version is
  'The EXTRACTOR_VERSION that produced this row. An entry stamped with anything else is a miss, which is how a parser fix reaches entries it did not write. See packages/import/src/cache-policy.ts.';

-- No index. Every read of this table is by primary key — the URL hash — and staleness is decided
-- on the row already in hand, not by scanning for stale ones.

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
