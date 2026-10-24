/*
 * ---------------------------------------------------------------------------
 * A protein absent from the enum does not come back null — it comes back wrong
 * ---------------------------------------------------------------------------
 *
 * `principal_protein` allowed nine values and `turkey` was not one of them. "Ground Turkey Rice
 * Bowls with Bang Bang Sauce" — the word is in the title — is stored as `pork`, and re-reading it
 * through the shipping classifier returned `pork` on three readings out of three. The model was
 * not failing to read the title; it was answering the only question it was allowed to answer.
 *
 * That is the shape worth naming, because it reads identically to a model being careless: forced
 * to a closed list, a model picks the **nearest available value** rather than declining, and the
 * answer arrives confident, well-formed and unobjectionable to everything downstream. The same
 * family as a tight `max_tokens` returning a valid empty answer.
 *
 * ---------------------------------------------------------------------------
 * Why these two and not a taxonomy
 * ---------------------------------------------------------------------------
 *
 * Measured across all 76 recipes in the real library — titles, ingredients, notes and steps —
 * there is **one turkey**, no duck, no tofu, tempeh, seitan, paneer, venison, goat, veal, rabbit
 * or bison, one chickpea and no lentils. So turkey is in on evidence.
 *
 * Duck is in on the failure mode rather than on evidence: its absence costs a duck recipe becoming
 * `chicken` — wrong in a way a person notices and cannot correct from the screen — and its
 * presence costs a browse chapter that does not render until a duck arrives, because `counted`
 * drops empty chapters. Those are not symmetric.
 *
 * Nothing else was added. Plant-protein dishes already have `vegetarian` and `vegan`, and the
 * classifier's instructions fold tofu into them in words.
 *
 * ---------------------------------------------------------------------------
 * The nine places this value had to be spelled, and the one it is spelled in now
 * ---------------------------------------------------------------------------
 *
 * This CHECK, the classifier's schema, the classifier's validation set, the extractor's schema,
 * the extractor's validation set, the hand-typed recipe's validation set, the filter chips, the
 * recipe form's picker and the browse chapters. Widening some of them is worse than widening none:
 * a model answering `turkey` past a validation set that has not heard of it is dropped to **null**,
 * and a row carrying a value no chapter holds is in Mains and in none of its subdivisions — in the
 * database and on no screen.
 *
 * They now read `PRINCIPAL_PROTEINS` from `@pashki/core`. SQL cannot import it, so
 * `packages/db/test/protein-enum.test.ts` compares this constraint's own definition against that
 * list and fails when they drift.
 */
alter table public.recipes
  drop constraint if exists recipes_principal_protein_check;

alter table public.recipes
  add constraint recipes_principal_protein_check
    check (principal_protein in
      ('chicken', 'turkey', 'duck', 'beef', 'pork', 'lamb', 'fish', 'seafood', 'egg',
       'vegetarian', 'vegan'));

/*
 * Asserted by **attempting the write**, not by reading the constraint's text.
 *
 * A definition assertion passes against a constraint whose words are right and whose behaviour is
 * not, and this project's rule is to verify a migration by attempting the thing it forbids. The
 * difficulty is that migrations run before the seed, so `recipes` is empty on every `db:reset` and
 * there is no row to write to — and a probe that could not have succeeded has measured nothing.
 *
 * So the probe needs no row. A CHECK is evaluated on the new tuple, **before** the foreign key's
 * trigger fires, so an insert naming a household that does not exist distinguishes the two
 * perfectly: `foreign_key_violation` means the protein passed the CHECK and the FK stopped it,
 * `check_violation` means the protein was refused. Nothing is ever written — every attempt here
 * fails by design, which is also why no migration can reclassify anybody's recipe.
 */
do $do$
declare
  candidate text;
begin
  foreach candidate in array array['turkey', 'duck', 'unicorn']
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
        raise exception '% is still refused by the CHECK', candidate;
      end if;
    end;
  end loop;
end;
$do$;

comment on column public.recipes.principal_protein is
  'The protein a main is built around — the axis the browse sketch leans on. Null when there is none or it is unclear. The values are PRINCIPAL_PROTEINS in @pashki/core; a test compares this constraint against that list, because a value present in the column and absent from the code is dropped to null and a value present in both and absent from the chapters is invisible.';

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
