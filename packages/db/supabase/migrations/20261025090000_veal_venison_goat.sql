/*
 * ---------------------------------------------------------------------------
 * Three proteins for households that are not this one
 * ---------------------------------------------------------------------------
 *
 * `20261024100000_turkey_and_duck` justified stopping at eleven by counting the one real library:
 * "no tofu, tempeh, seitan, paneer, venison, goat, veal, rabbit or bison". The count was right and
 * **the population was wrong.** A library with none of a thing says nothing about anybody else's,
 * and this is public signup on iOS, Android and web — Stephen has no venison, a hunting family in
 * Texas does. The same error as judging `principal_protein`'s fill rate across the whole library
 * when the question was about Mains, where it is 93%.
 *
 * So the cost of an absent value is unchanged and already measured: forced to a closed list a model
 * picks the **nearest available value** rather than declining, which is how "Ground Turkey Rice
 * Bowls" became `pork` on three readings of three. A goat curry would become lamb, and a venison
 * stew beef, confidently, with nothing downstream able to object.
 *
 * ---------------------------------------------------------------------------
 * What a value costs, now that it has been measured on both sides
 * ---------------------------------------------------------------------------
 *
 * The objection to a value with no instances was that the model can then reach for it, and that
 * was real: `duck` was used twice and wrong twice across four samples of one prompt. It was also
 * **zero across six samples of the next two prompts** — the misuse stopped when the prompt stopped
 * it, without the enum changing.
 *
 * That separates two questions this project had been answering as one. What the app may **store**
 * is this constraint. What the classifier may **assert** is the prompt, which now carries a naming
 * bar requiring the recipe to name the animal. Different faults, different fixes, and pruning the
 * enum would have been the wrong tool for the second (decisions §97).
 *
 * The screen cost is zero: `counted` drops empty chapters, so a value nobody has cooked renders
 * nothing. Each of the three has its own drawing under `public/chapters/`, placed before this
 * migration rather than after, because the tile appears the moment a household's first one lands
 * and a CSS mask pointing at a missing file paints nothing in either theme with no error anywhere.
 */
alter table public.recipes
  drop constraint if exists recipes_principal_protein_check;

alter table public.recipes
  add constraint recipes_principal_protein_check
    check (principal_protein in
      ('chicken', 'turkey', 'duck', 'beef', 'veal', 'pork', 'lamb', 'goat', 'venison',
       'fish', 'seafood', 'egg', 'vegetarian', 'vegan'));

/*
 * Asserted by **attempting the write**, not by reading the constraint's text — the same probe the
 * turkey migration established, and the same reason: a definition assertion passes against a
 * constraint whose words are right and whose behaviour is not.
 *
 * The probe needs no row, which is what makes it work on an empty database. A CHECK is evaluated
 * on the new tuple **before** the foreign key's trigger fires, so an insert naming a household
 * that does not exist separates the two perfectly: `foreign_key_violation` means the value passed
 * the CHECK and the FK stopped it, `check_violation` means the value was refused. Every attempt
 * fails by design and nothing is ever written, which is also why no migration here can reclassify
 * anybody's recipe.
 *
 * `turkey` and `duck` are probed again rather than assumed: this statement replaces the whole
 * constraint, so a value dropped by a typo in the list above would be silently gone and the only
 * symptom would be a 400 the import path swallows and a field landing null.
 */
do $do$
declare
  candidate text;
begin
  foreach candidate in array array['veal', 'venison', 'goat', 'turkey', 'duck', 'unicorn']
  loop
    declare
      refused_by text;
    begin
      begin
        insert into public.recipes (family_id, title, principal_protein)
        values (gen_random_uuid(), 'constraint probe', candidate);
        -- unreachable: the household does not exist
        raise exception 'the probe inserted a row — recipes.family_id no longer references families';
      exception
        when foreign_key_violation then refused_by := 'fk';
        when check_violation then refused_by := 'check';
      end;

      if candidate = 'unicorn' and refused_by <> 'check' then
        raise exception 'the CHECK accepted an unknown protein (refused by %)', refused_by;
      end if;
      if candidate <> 'unicorn' and refused_by <> 'fk' then
        raise exception '% is refused by the CHECK', candidate;
      end if;
    end;
  end loop;
end;
$do$;

comment on column public.recipes.principal_protein is
  'The protein a main is built around — the axis the browse sketch leans on. Null when there is none or it is unclear. The values are PRINCIPAL_PROTEINS in @pashki/core; a test compares this constraint against that list, because a value present in the column and absent from the code is dropped to null and a value present in both and absent from the chapters is invisible. A value with no recipes costs nothing on screen (counted drops empty chapters); what it costs is a model reaching for it, which the classifier''s naming bar governs rather than this list.';

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
