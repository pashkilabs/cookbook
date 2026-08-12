-- Provenance is asserted at ingest, not edited afterwards.
--
-- `photos.source` records whose photograph it is: 'import' is the original blogger's,
-- 'camera' is the household's own. `private.photo_object_is_public()` serves an object
-- to anon only when it is 'camera' on a published recipe — the same subset the `photos`
-- table allows anon — because republishing someone else's photograph is what the open
-- copyright question governs (decisions §17).
--
-- The audit found that `authenticated` held table-wide UPDATE, so a household could flip
-- 'import' to 'camera' on an existing row. Verified: the update was accepted and anon
-- could then read the blogger's photo. One column write turned a photograph we fetched
-- from someone else's site into "the household's own", world-readable.
--
-- `storage_path` had the same exposure, and `width`/`height`/`recipe_id` are measured or
-- decided at ingest. So the client-editable surface on a photos row is: delete it, and
-- mark its bytes uploaded. Nothing else on the row is a user's opinion.
--
-- **The ceiling, stated honestly.** This closes the one-line flip, not the underlying
-- posture. A household that wants to republish an imported photograph can, once camera
-- upload exists, download the bytes and upload them as its own — laundering provenance
-- is available to anyone determined, and no constraint here can prevent it. What this
-- prevents is doing it by accident or by curiosity, and what actually settles it is the
-- unresolved copyright question, not a grant.

revoke update on public.photos from authenticated;

grant update (deleted_at, upload_state) on public.photos to authenticated;

-- INSERT keeps `source`: a camera photo legitimately arrives labelled as one. It is the
-- *re*-labelling that had no honest use, and 090900's UNIQUE (storage_path) means a new
-- row cannot claim an object an existing row already describes.

do $do$
declare
  leaked text[];
  ingest_owned text[] := array[
    'source', 'storage_path', 'recipe_id', 'family_id', 'width', 'height',
    'created_at', 'updated_at'
  ];
begin
  select coalesce(array_agg(distinct a.attname order by a.attname), '{}')
  into leaked
  from pg_attribute a
  where a.attrelid = 'public.photos'::regclass
    and a.attname = any (ingest_owned)
    and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');

  if array_length(leaked, 1) > 0 then
    raise exception
      'a client can rewrite a photo''s provenance or identity, which republishes another site''s photograph as the household''s own: %',
      array_to_string(leaked, ', ');
  end if;

  if not has_column_privilege('authenticated', 'public.photos'::regclass, 'deleted_at', 'UPDATE') then
    raise exception 'a client cannot remove its own photo';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
