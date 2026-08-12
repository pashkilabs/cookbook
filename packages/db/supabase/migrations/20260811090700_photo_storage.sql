-- Storage for recipe photos.
--
-- One private bucket, with read access decided by exactly the same rules as the
-- `photos` table: a household sees its own, and anon sees a photo only when the
-- recipe is published and the photograph is the household's own. Two sets of rules
-- that were supposed to agree would eventually stop agreeing, so the storage policies
-- consult the `photos` row rather than restating its conditions.

-- `public = false` is the single most important line in this file.
--
-- A public Supabase bucket serves every object to anyone with the URL and **bypasses
-- row-level security entirely** — the policies below would still exist and would
-- decide nothing. Publication is a per-recipe decision (decisions §17), so the bucket
-- cannot be the thing that grants it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-photos',
  'recipe-photos',
  false,
  -- imported photos are resized on ingest, so anything near this is a bug rather
  -- than a big picture
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Object paths map to rows by `photos.storage_path = storage.objects.name`.
--
-- Matching on the stored path rather than parsing folder names out of the key. A path
-- convention encoded in a policy is a second source of truth: rename the convention
-- and the policy silently keeps matching the old shape.
--
-- SECURITY DEFINER because these read `photos` and `recipes`, both of which are
-- protected. Evaluated as the caller they would re-enter those tables' policies, and
-- the anon case would depend on a chain of policies rather than one stated rule.
-- ---------------------------------------------------------------------------

create or replace function private.photo_object_is_public(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.photos p
    where p.storage_path = p_object_name
      and p.deleted_at is null
      -- the household's own photograph only. An 'import' photo is the original
      -- blogger's, and republishing it is what the open copyright question governs
      -- (decisions §17) — the same subset the photos table allows anon.
      and p.source = 'camera'
      and private.recipe_is_public(p.recipe_id)
  )
$$;

comment on function private.photo_object_is_public is
  'True when a storage object belongs to a published recipe as the household''s own photograph. Mirrors the anon policy on public.photos by consulting the same row.';

create or replace function private.photo_object_in_household(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.photos p
    where p.storage_path = p_object_name
      and p.family_id in (select private.current_family_ids())
  )
$$;

comment on function private.photo_object_in_household is
  'True when a storage object belongs to a photo row in one of the caller''s households. Tombstones included, so a deletion can still be reconciled.';

grant execute on function private.photo_object_is_public(text) to anon, authenticated;
grant execute on function private.photo_object_in_household(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Read policies. There are no write policies at all.
--
-- Objects are put there by the import service on the service role, which bypasses
-- RLS. A client upload path is a Phase 3 concern (photographing the finished plate)
-- and will need its own policy written deliberately — not inherited from here.
--
-- An object with no `photos` row is readable by nobody but the service role. That is
-- the correct state for an import awaiting review: no import saves without the user
-- seeing it, so the row appears when they accept, and until then the picture is not
-- reachable by any client.
-- ---------------------------------------------------------------------------

create policy recipe_photos_read_public on storage.objects
  for select to anon
  using (
    bucket_id = 'recipe-photos'
    and private.photo_object_is_public(name)
  );

create policy recipe_photos_read_in_household on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recipe-photos'
    and (
      private.photo_object_in_household(name)
      -- a signed-in person following a friend's published link, same as recipes
      or private.photo_object_is_public(name)
    )
  );

-- ---------------------------------------------------------------------------
-- Self-check: the invariants that would be expensive to discover later.
-- ---------------------------------------------------------------------------

do $do$
declare
  is_public boolean;
  write_policies text[];
  anon_read_policies text[];
begin
  select b.public into is_public from storage.buckets b where b.id = 'recipe-photos';
  if is_public is null then
    raise exception 'the recipe-photos bucket was not created';
  end if;
  if is_public then
    raise exception
      'the recipe-photos bucket is public, which serves every object to anyone with the URL and bypasses the policies below entirely';
  end if;

  -- no client may write to the bucket. A write policy here would let a household
  -- put an object at a path some other household''s photos row already names.
  select coalesce(array_agg(p.polname order by p.polname), '{}')
  into write_policies
  from pg_policy p
  where p.polrelid = 'storage.objects'::regclass
    and p.polcmd in ('a', 'w', 'd')
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
        || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%recipe-photos%';

  if array_length(write_policies, 1) > 0 then
    raise exception
      'client write policies exist on the recipe-photos bucket: %',
      array_to_string(write_policies, ', ');
  end if;

  -- every anon read path must consult recipe visibility. An anon policy that merely
  -- checked bucket_id would publish the whole bucket.
  select coalesce(array_agg(p.polname order by p.polname), '{}')
  into anon_read_policies
  from pg_policy p
  join pg_roles r on r.oid = any (p.polroles)
  where p.polrelid = 'storage.objects'::regclass
    and r.rolname = 'anon'
    and p.polcmd in ('r', '*')
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%photo_object_is_public%';

  if array_length(anon_read_policies, 1) > 0 then
    raise exception
      'anon read policies on storage.objects do not consult recipe visibility: %',
      array_to_string(anon_read_policies, ', ');
  end if;
end;
$do$;
