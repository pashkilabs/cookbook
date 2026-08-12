-- `input_ref` for a screenshot or a video names a storage object. Scope it to the
-- household now, while nothing reads it.
--
-- This is the `photos.storage_path` shape again: a client-supplied string that something
-- server-side resolves. A screenshot job says "the image is at this path", and the worker
-- runs on the service role, which bypasses RLS. Nothing tied that path to the household
-- that submitted the job, so a job could name **another household's object** and have the
-- worker fetch it, extract from it, and write the result into `result_json` on a row the
-- submitting household can read. A photograph of somebody else's kitchen, described back
-- to whoever asked.
--
-- **It is not exploitable today**, and that is why this is being fixed rather than
-- reported: `job-runner.ts` refuses `screenshot` and `video` with an
-- `unsupported-job-kind` failure, because tier 3 takes images rather than a path and
-- video is Phase 4. So there is no attack right now — there is a hole waiting for the
-- day somebody wires tier 3 to the queue, at which point the vulnerability arrives with
-- a feature that looks unrelated to it. The whole reason the audit went looking was that
-- the photos version of this existed for several sessions.
--
-- The constraint mirrors 090900's `photos_path_in_household` deliberately, including the
-- reasoning: enforce the convention on write, where a change to it fails loudly, rather
-- than in a policy, where it would go on matching the old shape in silence.

alter table public.import_jobs
  add constraint import_jobs_input_ref_in_household
    check (
      -- url and text jobs carry a URL or a cache key, neither of which is ours to scope.
      -- Their guard is in packages/import, where a URL can actually be resolved.
      kind not in ('screenshot', 'video')
      or input_ref like family_id::text || '/%'
    );

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.import_jobs'::regclass
      and conname = 'import_jobs_input_ref_in_household'
  ) then
    raise exception 'a screenshot job can name an object outside its own household';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
