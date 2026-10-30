/*
 * ---------------------------------------------------------------------------
 * A heading is prose, and prose runs long: 80 characters to 200
 * ---------------------------------------------------------------------------
 *
 * `20260909090000_ingredient_section` capped `section` at 80, which was a guess about how long a
 * heading is. Surveying every sourced recipe in the real library found one at **79** —
 *
 *   "For Sauce (Or you may substitute 3-4 cups of your favorite, quality marinara sauce)"
 *
 * — a legitimate heading on The BEST Meatball Recipe, one character inside a limit nobody had
 * measured against anything. That is not a margin; it is a constraint that has not failed yet.
 *
 * The failure it would cause is the quiet kind. A heading over the cap fails the insert, the import
 * route reports the recipe rather than the column, and the symptom is "this recipe would not save"
 * for a reason nothing names. 200 is still a bound rather than free text — a section is a label,
 * and something arriving at a thousand characters is markup the reader misread, which the caller
 * clamps to this same number before writing.
 */
alter table public.recipe_ingredients
  drop constraint if exists recipe_ingredients_section_check;

alter table public.recipe_ingredients
  add constraint recipe_ingredients_section_check
    check (section is null or length(section) between 1 and 200);

/*
 * Asserted by attempting the writes, not by reading the constraint — a definition can be right
 * about its words and wrong about its behaviour.
 *
 * The probe needs no row, which is what lets it run on the empty table every `db:reset` leaves.
 * A CHECK is evaluated on the new tuple before the foreign key's trigger fires, so an insert naming
 * a recipe that does not exist separates them exactly: `foreign_key_violation` means the value
 * passed the CHECK, `check_violation` means it was refused. Nothing is ever written.
 *
 * `family_id` is spelled even though the row never lands: **every app table carries it, NOT NULL**,
 * so omitting it raises 23502 before either foreign key is reached — which the handler below does
 * not catch, so the migration fails with a message about a column rather than about the section it
 * was testing. The first version of this probe did exactly that.
 *
 * Three candidates: the real 83-character heading this migration exists for, which must now pass;
 * an empty string, which must still be refused, because a section that is present and says nothing
 * is a bug upstream rather than a heading; and 201 characters, to prove the new bound is the bound
 * and not merely larger than the old one.
 */
do $do$
declare
  candidate text;
  expected text;
begin
  foreach candidate in array array[
    'For Sauce (Or you may substitute 3-4 cups of your favorite, quality marinara sauce)',
    '',
    repeat('x', 201)
  ]
  loop
    expected := case when length(candidate) between 1 and 200 then 'fk' else 'check' end;
    declare
      refused_by text;
    begin
      begin
        insert into public.recipe_ingredients (family_id, recipe_id, position, item_text, section)
        values (gen_random_uuid(), gen_random_uuid(), 0, 'constraint probe', candidate);
        raise exception 'the probe inserted a row — recipe_ingredients.recipe_id no longer references recipes';
      exception
        when foreign_key_violation then refused_by := 'fk';
        when check_violation then refused_by := 'check';
      end;

      if refused_by <> expected then
        raise exception 'a % character section was refused by %, expected %',
          length(candidate), refused_by, expected;
      end if;
    end;
  end loop;
end;
$do$;

comment on column public.recipe_ingredients.section is
  'The recipe''s own heading for the run of lines this one belongs to — "Sauce", "For the Chicken". Free text as the source wrote it, less a trailing colon; never normalised, because the method refers to it in those words. NULL is correct and common: most recipes have no sections and many have ungrouped lines before the first heading. A presentation label only — it must never reach the shopping list''s consolidation key, which is asserted in packages/core/test/consolidate.test.ts.';

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
