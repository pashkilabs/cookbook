/*
 * ---------------------------------------------------------------------------
 * What a classification attempt was made WITH, so a changed one can be retried
 * ---------------------------------------------------------------------------
 *
 * `classified_at` records that an attempt happened and nothing about what it was made with, so
 * "we tried" and "we succeeded" are the same value. The backfill's cursor is
 * `classified_at is null`, which means **a row tried once and come back empty is never tried
 * again**.
 *
 * Measured on the real library: 49 of 76 recipes are stamped with a null principal protein, and
 * re-running the classifier today names one for **7 of the first 10** — `pork` for a sausage
 * manicotti, `beef` for a meatball recipe, `chicken` for a white chicken chili. The three that
 * stay null are correctly null: a stuffing, dinner rolls, and a s'mores dessert.
 *
 * Every protein in the library was recorded in August; not one since, across thirty
 * classifications in September and October. `classify.ts` has a single commit and has never been
 * edited, so the prompt is not the variable — `PASHKI_LLM_MODEL` lives in the deployment's
 * environment, changed at some point, and **nothing in the schema or the code could see that it
 * had**.
 *
 * ---------------------------------------------------------------------------
 * Why a fingerprint rather than a boolean
 * ---------------------------------------------------------------------------
 *
 * A `classification_failed` flag would answer "did it come back empty" and not "is that emptiness
 * still current". The question a retry has to ask is whether anything that produces the answer has
 * changed since — and this project already has the mechanism: `promptKey` and
 * `COMPONENTS_PROMPT_FINGERPRINT` exist because *"a stamp only works if something turns it"*.
 *
 * **And it must cover the model, not just the prompt**, which is the new part. The components and
 * palate fingerprints hash instructions and schema, because those were the inputs that changed.
 * Here the prompt never moved and the answer did, so a prompt-only digest would have been another
 * stamp nobody turned. The value stored is the prompt digest AND the model id.
 *
 * A row whose stored value equals the current one is settled — a dessert with no protein stays
 * answered. A row whose value differs, or is absent, is eligible to be asked again.
 */
alter table public.recipes
  add column if not exists classified_with text;

comment on column public.recipes.classified_with is
  'The prompt digest and model id a classification was made with, so a changed prompt or model makes the row eligible for a retry while an unchanged one leaves a correct null settled (§90). classified_at records only that an attempt happened.';

/*
 * No backfill of the column itself. Every existing row gets NULL, which is exactly right: none of
 * them recorded what they were classified with, so none of them can be shown to be current, and
 * all of them are eligible to be asked again. That is the intended first outcome rather than a
 * migration gap.
 */

/*
 * The client cannot write it, for the reason it cannot write `classified_at`: a caller that could
 * stamp its own provenance could mark a row current without ever asking a model (§26 — grant
 * columns, not tables).
 */
revoke update (classified_with) on public.recipes from anon, authenticated;
grant select (classified_with) on public.recipes to authenticated;

create or replace function private.assert_classification_records_its_inputs()
returns void
language plpgsql
as $$
declare
  n int;
begin
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'recipes' and column_name = 'classified_with';
  if n <> 1 then
    raise exception 'recipes.classified_with is gone — a classification that cannot say what produced it cannot be retried when the prompt or the model changes';
  end if;

  /*
   * And a client must not be able to stamp it. The whole value of the column is that it is
   * evidence about what ran; evidence a caller can write is not evidence.
   */
  select count(*) into n
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'recipes'
    and column_name = 'classified_with'
    and privilege_type = 'UPDATE'
    and grantee in ('anon', 'authenticated');
  if n > 0 then
    raise exception 'a client can write recipes.classified_with — it could then mark a row current without asking a model';
  end if;
end;
$$;

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
  perform private.assert_birth_year_stays_in_platform();
  perform private.assert_blends_never_public();
  perform private.assert_public_reads_revoked();
  perform private.assert_times_made_is_derived();
  perform private.assert_import_drain_retired();
  perform private.assert_pantry_base_is_countable();
  perform private.assert_preferences_carry_no_score();
  perform private.assert_allergens_are_household_wide();
  perform private.assert_cart_is_write_only_and_remembered();
  perform private.assert_recipe_layout_is_per_member();
  perform private.assert_allergen_changes_are_logged_and_private();
  perform private.assert_no_family_propagation_triggers();
  perform private.assert_classification_records_its_inputs();
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
