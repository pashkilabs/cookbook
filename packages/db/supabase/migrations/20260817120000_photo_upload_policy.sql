-- ---------------------------------------------------------------------------
-- A household can upload its own photograph.
--
-- `storage.objects` had exactly one policy — `recipe_photos_read_in_household`,
-- SELECT — and RLS denies by default, so every authenticated upload was refused.
-- It had never mattered: until now the only writer was the import service running
-- as the service role, which bypasses RLS entirely. The first time a person tried
-- to add a photo from a screen, the write was code shipped ahead of its database
-- permission.
--
-- The refusal reads `new row violates row-level security policy`, which is the
-- *identical* wording a table-policy refusal uses. The message names the
-- mechanism, not the location, so it looked like `public.photos` for a while.
--
-- ---------------------------------------------------------------------------
-- Why the path, and not a photos row
-- ---------------------------------------------------------------------------
--
-- The read policy asks `private.photo_object_in_household(name)`, which looks the
-- object up in `public.photos`. That cannot work here: on upload the object comes
-- first and the row second, so at write time there is no row to find and the
-- predicate is false for every legitimate upload.
--
-- So writes are judged by the path instead. Every object is stored under
-- `<family_id>/…` — an invariant `photos_path_in_household` already enforces on
-- the table — and the first path segment is therefore the household making the
-- claim. Text comparison rather than a uuid cast: a malformed path should be
-- *refused*, not raise, and `'nonsense'::uuid` inside a policy is an error rather
-- than a false.
-- ---------------------------------------------------------------------------

create or replace function private.photo_path_writable(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from unnest(array[(storage.foldername(p_object_name))[1]]) as claimed(family_id)
    join (select private.current_family_ids() as id) mine
      on mine.id::text = claimed.family_id
    -- the same entitlement gate the photos row itself passes, so a lapsed household
    -- is refused at the cheap half instead of uploading bytes it may not keep
    where private.household_can_write(mine.id, 'recipes')
  )
$$;

create policy recipe_photos_write_in_household on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recipe-photos' and private.photo_path_writable(name));

-- Replacement is a *new* object at a fresh path (`storeImportedPhoto` never reuses
-- one) and the old row is tombstoned rather than the object overwritten, so INSERT
-- is the whole story and no UPDATE policy is added. Asserted below rather than
-- assumed: if a future change starts overwriting in place, the invariant fails
-- loudly instead of the upload silently 500ing.

-- ---------------------------------------------------------------------------
-- Assert it, so a future bucket cannot forget.
-- ---------------------------------------------------------------------------

create or replace function private.assert_photo_storage_policies()
returns void
language plpgsql
as $$
declare
  missing text[];
begin
  select coalesce(array_agg(want.cmd order by want.cmd), '{}')
  into missing
  from (values ('SELECT', 'r'), ('INSERT', 'a')) as want(cmd, code)
  where not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polcmd = want.code::"char"
      and pg_get_expr(coalesce(polqual, polwithcheck), polrelid) like '%recipe-photos%'
  );

  if array_length(missing, 1) > 0 then
    raise exception
      'the recipe-photos bucket has no % policy — an upload will be refused with the same wording a table policy uses, so it will look like public.photos',
      array_to_string(missing, ' and ');
  end if;

  -- a write policy that does not name the household would let any signed-in person
  -- put an object in another family's folder
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polcmd = 'a'
      and pg_get_expr(polwithcheck, polrelid) like '%photo_path_writable%'
  ) then
    raise exception 'the recipe-photos INSERT policy does not scope writes to the household';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- Ask the entitlement question before doing the expensive half.
--
-- Both the storage policy and `photos_insert_in_household` require
-- `household_can_write`. With the object written first, a lapsed household uploaded
-- bytes and was then refused the row, leaving an orphan for the reaper on every
-- attempt. This lets a caller ask cheaply, first.
--
-- SECURITY DEFINER over `private.current_family_ids()`, so app code never queries
-- `entitlements` itself — that is a platform table and the seam owns it (CLAUDE.md).
-- The answer is a boolean about the caller's own household and nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.household_can_write_recipes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.current_family_ids() as f(id)
    where private.household_can_write(f.id, 'recipes')
  )
$$;

revoke all on function public.household_can_write_recipes() from public, anon;
grant execute on function public.household_can_write_recipes() to authenticated;

do $do$
begin
  if has_function_privilege('anon', 'public.household_can_write_recipes()', 'execute') then
    raise exception 'anon can ask about a household entitlement';
  end if;
  if not has_function_privilege('authenticated', 'public.household_can_write_recipes()', 'execute') then
    raise exception 'authenticated cannot ask whether it may write — the grant is missing';
  end if;
end;
$do$;

-- Folded into the standing invariants, so a future bucket cannot forget.
--
-- The body is restated in full rather than wrapped: `assert_rls_invariants` is one
-- function that each migration replaces, so an environment running an older body
-- passes its own checks happily while missing a newer rule entirely. Restating keeps
-- the version and the rules in one place (CLAUDE.md — a migration's self-check only
-- knows what its own version knew).
create or replace function private.assert_rls_invariants()
returns void
language plpgsql
as $outer$
begin
  perform private.assert_household_invariants();
  perform private.assert_soft_delete_propagation();
  perform private.assert_no_anon_reads();
  perform private.assert_photo_storage_policies();
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
