/*
 * ---------------------------------------------------------------------------
 * How many readings a classification is, and how much they agreed
 * ---------------------------------------------------------------------------
 *
 * `componentsFor` reads a recipe three times and stores the consensus with its agreement and its
 * reading count. Classification stored **one** reading, and the difference showed: the same recipe
 * and the same prompt returned `[null, chicken, null]` and `[pork, seafood, seafood]` on three
 * calls at `temperature: 0`, because a reasoning model is not deterministic there. A single sample
 * of a varying answer is a coin landing where it lands.
 *
 * So the classifier votes now, and these two columns are what it stores beside the answer.
 *
 * **Recorded, never gated on.** `COMPONENT_TRUST` carries the measurement that three readings
 * agreeing perfectly were still wrong four times in eleven — agreement is consistency, not
 * correctness — so nothing may admit or suppress a classification on this number. What it is for
 * is telling a reader which rows are soft: a 2-of-3 stored as 2-of-3 is a row somebody can be
 * pointed at, and the reverse claim is the sound one, that low agreement is real evidence of
 * trouble while high agreement is evidence of nothing.
 *
 * Per field, not per row, because the fields are voted independently and one number for four
 * answers would be a lie about three of them: a dish can be unanimously a main and a coin-flip
 * between pork and seafood, and that is the row a person most needs to see.
 *
 * `classified_` rather than `classification_`, matching `classified_at` and `classified_with`: a
 * reader looking for this feature's columns greps one prefix.
 */
alter table public.recipes
  add column if not exists classified_agreement jsonb
    check (classified_agreement is null or jsonb_typeof(classified_agreement) = 'object'),
  add column if not exists classified_readings smallint
    check (classified_readings is null or classified_readings between 0 and 3);

comment on column public.recipes.classified_agreement is
  'Per field, the share of the readings that gave the stored answer, 0..1 — {"course":1,"principalProtein":0.67}. Recorded so a reader can see which rows are soft; never gated on, because agreement is consistency and not correctness (COMPONENT_TRUST).';
comment on column public.recipes.classified_readings is
  'How many of the three readings came back at all. A row built on one reading during an outage must not read as confidently as one three readings agreed on, so agreement is stored as 0 when this is 1.';

/*
 * No client write, for the reason `classified_with` has none: these two are **evidence about what
 * a model did**, and evidence a caller can write is not evidence. A client able to stamp three
 * unanimous readings could make any hand-typed guess look like a measured one.
 *
 * SELECT is granted, because the whole point is that a person can see a soft row.
 */
revoke insert (classified_agreement, classified_readings) on public.recipes from anon, authenticated;
revoke update (classified_agreement, classified_readings) on public.recipes from anon, authenticated;
grant select (classified_agreement, classified_readings) on public.recipes to authenticated;

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
   *
   * The same claim covers the agreement and the reading count, which are evidence of the same
   * kind: a client that could write "three readings agreed" could dress a guess as a measurement.
   */
  select count(*) into n
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'recipes'
    and column_name in ('classified_with', 'classified_agreement', 'classified_readings')
    and privilege_type in ('INSERT', 'UPDATE')
    and grantee in ('anon', 'authenticated');
  if n > 0 then
    raise exception 'a client can write recipes.classified_with, classified_agreement or classified_readings — it could then dress its own guess as a measured classification';
  end if;
end;
$$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
