-- The shared cache cannot hold a household's storage path.


/*
 * `import_cache` is keyed by URL hash and belongs to nobody: one row serves every household that
 * imports that page. `photo_path` was a column for a storage path, and a storage path here is
 * `<family_id>/<uuid>.jpg` — one household's object, handed to whoever hits the cache next.
 *
 * Nothing ever wrote it, which is the only reason this is a dropped column rather than an
 * incident. Every read policy on `recipe-photos` resolves through a `photos` row, so a second
 * household given that path could not have read the bytes — but it would have written the path
 * into its own `photos.storage_path`, and `photos_path_in_household` would then refuse the
 * insert. A cross-tenant reference that fails a constraint check is still a cross-tenant
 * reference, and the column invited one.
 *
 * What the cache carries instead is the *source* image URL, which is already inside
 * `extracted_json` as part of the extracted recipe: a public address on somebody else's website,
 * identifying nobody. A cache hit re-fetches it and stores the bytes in the requesting
 * household's own folder — see decisions §33.
 */
alter table public.import_cache drop column if exists photo_path;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
