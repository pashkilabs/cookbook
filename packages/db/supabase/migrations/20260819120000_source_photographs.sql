-- ---------------------------------------------------------------------------
-- Keep the card.
--
-- Photographing a recipe card reads it and then throws the photograph away. For a
-- handwritten card that image is the only record of the original — the hand it was
-- written in, what was crossed out, the splash of vanilla — and the extraction
-- cannot be re-checked against anything once it is gone. Every card photographed
-- until now is lost.
--
-- ---------------------------------------------------------------------------
-- Why it cannot simply be a dish photo
-- ---------------------------------------------------------------------------
--
-- §17 makes published recipes world-readable, and a photograph of a printed page
-- carries someone else's copyright. So a source photograph must be visible to its
-- household **regardless of whether the recipe is published**, which is the exact
-- inverse of how a dish photograph behaves.
--
-- **That asymmetry is the design.** `camera` follows the recipe's visibility;
-- `source` never does. `import` is the original site's image and was already
-- excluded for the same reason.
--
-- The public predicate is an allow-list — `p.source = 'camera'` — so a new value is
-- private by construction rather than by remembering. That is the right shape and
-- it is also invisible: nothing today would notice if someone widened it to
-- `p.source <> 'import'` and quietly published every card in the system. So the
-- guarantee is asserted below rather than left resting on the shape of a WHERE
-- clause.
-- ---------------------------------------------------------------------------

alter table public.photos drop constraint if exists photos_source_check;
alter table public.photos
  add constraint photos_source_check
  check (source = any (array['import', 'camera', 'upload', 'source']));

comment on column public.photos.source is
  'camera = the household''s own dish photograph, follows the recipe''s visibility. source = a photograph OF the recipe (a card, a page), never published whatever the recipe''s visibility, because it carries someone else''s copyright. import = the original site''s image.';


-- ---------------------------------------------------------------------------
-- The row, not only the object.
--
-- Found by the assertion below, before this shipped: `photos_select_public_any`
-- read `deleted_at is null and recipe_is_public(recipe_id)` and said nothing about
-- `source`. The storage predicate is an allow-list of 'camera', so the bytes of a
-- card were safe — but the **row** was not, and a row carries `storage_path`. Any
-- signed-in member of any other household could read the path of a card photograph
-- attached to a published recipe.
--
-- A leaked path is not a leaked photograph. It is still the wrong answer to
-- "who may see that this exists, and where it lives", and the two policies
-- disagreeing is precisely the second-source-of-truth this schema keeps refusing.
-- ---------------------------------------------------------------------------

drop policy if exists photos_select_public_any on public.photos;
create policy photos_select_public_any on public.photos
  for select to authenticated
  using (
    deleted_at is null
    -- the same allow-list the storage predicate uses, for the same reason
    and source = 'camera'
    and private.recipe_is_public(recipe_id)
  );

-- ---------------------------------------------------------------------------
-- The guarantee, asserted rather than assumed.
-- ---------------------------------------------------------------------------

create or replace function private.assert_source_photos_never_public()
returns void
language plpgsql
as $$
declare
  body text;
begin
  body := pg_get_functiondef('private.photo_object_is_public(text)'::regprocedure);

  -- an allow-list naming exactly 'camera' is the only shape that keeps a source
  -- photograph private by construction; anything broader is a way to publish a card
  if body not like '%source = ''camera''%' then
    raise exception
      'photo_object_is_public no longer restricts to source = camera — a photograph of a copyrighted page can now reach a published recipe (decisions §17)';
  end if;

  if body like '%<>%' or body like '%!=%' or body like '%not in%' then
    raise exception
      'photo_object_is_public uses an exclusion rather than an allow-list, so a new photo source would be published by default';
  end if;

  -- and the table's own public policy must agree with the storage one
  if (
    select pg_get_expr(polqual, polrelid) from pg_policy
    where polrelid = 'public.photos'::regclass and polname = 'photos_select_public_any'
  ) not like '%camera%' then
    raise exception 'photos_select_public_any does not restrict to camera';
  end if;
end;
$$;

-- folded into the standing invariants; the body is restated in full because this is
-- one function each migration replaces, and an environment running an older body
-- passes its own checks while missing the newer rule
create or replace function private.assert_rls_invariants()
returns void
language plpgsql
as $outer$
begin
  perform private.assert_household_invariants();
  perform private.assert_soft_delete_propagation();
  perform private.assert_no_anon_reads();
  perform private.assert_photo_storage_policies();
  perform private.assert_source_photos_never_public();
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
