-- A photo taken offline, and the path it will occupy.
--
-- `docs/on-device.md` §5 found that `photos.storage_path` assumes its object already
-- exists. It does for an import — the service fetches, resizes and uploads before the
-- row is written — but a photograph taken with no signal has a row and local bytes and
-- no object, and Phase 3's camera would have discovered this while building a screen.
--
-- Two shapes were available.
--
-- *Nullable path.* Null means not uploaded. Rejected. The path is derivable at capture
-- from data the device already holds — `family_id` and a locally minted uuid — so
-- nothing is waiting on the server to assign it, and a null would be describing a
-- state rather than a missing fact. It also drops NOT NULL for every row including
-- imports, weakening an invariant that holds for most rows in order to express a
-- condition affecting some. And it leaves "no object yet" indistinguishable from "no
-- object ever".
--
-- *An explicit state, path always present.* Chosen. The path is final from the moment
-- of capture, so a second device knows where the bytes will be before they arrive, and
-- the object becomes readable the instant it lands with no row update in between.
--
-- What a null would have done to the read policies, since they resolve through this
-- column: nothing dangerous — `null = objects.name` is never true, so a null row
-- matches no object and both policies fail closed. The right direction, but silent, and
-- silence is what the state makes legible.

alter table public.photos
  add column upload_state text not null default 'stored'
    check (upload_state in ('pending', 'stored'));

comment on column public.photos.upload_state is
  'stored: the object exists. pending: the path is reserved and the bytes are still on a device. Default stored because every path written before this migration has its object, and because the import path uploads before it inserts.';

-- The uploader's query, not a scan of every photograph ever taken.
create index photos_pending_upload
  on public.photos (created_at)
  where upload_state = 'pending' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- The read policies trust this row. So the row has to be trustworthy.
-- ---------------------------------------------------------------------------
--
-- Found while checking what a pending path does to the storage policies, which is a
-- worse bug than the one this migration set out to fix.
--
-- `private.photo_object_in_household()` and `private.photo_object_is_public()` decide
-- access by looking for a `photos` row whose `storage_path` equals the object name.
-- Clients can insert `photos` rows. Nothing tied a row's path to its own household, so
-- a household could insert a row naming *another household's object* and inherit read
-- access to it. Verified end to end before the fix: denied, claim accepted, then read.
-- With `source = 'camera'` on a published recipe it also made another household's
-- private photograph world-readable to anon.
--
-- The fix goes on the row rather than in the policy, deliberately. Parsing the path
-- inside a policy is what 090700 rejected — a convention encoded in a policy is a
-- second source of truth that keeps matching the old shape after the convention moves.
-- A CHECK is enforced on write, so if the convention changes, the next insert fails
-- loudly instead of a policy quietly authorising the wrong object.

alter table public.photos
  add constraint photos_path_in_household
    check (storage_path like family_id::text || '/%');

-- One object, one row. Otherwise a household can attach a second row to an object it
-- already owns — which matters because deleting one row leaves the object still
-- authorised by the other, and because a row claiming an import's path with
-- `source = 'camera'` would publish the blogger's photograph. Guessing the path
-- requires guessing a uuid, and this turns the attempt into a loud failure for the
-- import rather than a quiet change of visibility.
alter table public.photos
  add constraint photos_storage_path_unique unique (storage_path);

-- `anon` reads `photos` through column grants (see 090500), so `upload_state` is
-- deliberately not granted to it. A published page has no question the state answers,
-- and adding a column no client asked for is how a column grant stops being a
-- deliberate list.

-- ---------------------------------------------------------------------------
-- Self-check.
-- ---------------------------------------------------------------------------

do $do$
declare
  policy_names text[];
begin
  -- The state must not reach the read policies. Between an upload finishing and the row
  -- being updated, a policy checking `upload_state` would deny an object that exists.
  -- The path authorises; the state is for the uploader.
  select coalesce(array_agg(p.polname order by p.polname), '{}')
  into policy_names
  from pg_policy p
  where p.polrelid = 'storage.objects'::regclass
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%upload_state%';

  if array_length(policy_names, 1) > 0 then
    raise exception
      'a storage policy consults upload_state, which denies reads in the window between an upload completing and the row being updated: %',
      array_to_string(policy_names, ', ');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photos'::regclass and conname = 'photos_path_in_household'
  ) then
    raise exception 'photos rows can name a path outside their own household';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photos'::regclass and conname = 'photos_storage_path_unique'
  ) then
    raise exception 'two photos rows can claim one storage object';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
