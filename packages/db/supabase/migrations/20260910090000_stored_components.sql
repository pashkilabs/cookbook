-- ---------------------------------------------------------------------------
-- Components are computed once and kept, not inferred on every view.
--
-- Inference scored `right` on 11, 12 and 19 of thirty across three identical
-- runs. That eight-point spread is not a quality problem to be tuned away — it is
-- an argument about *where* the answer lives. A household visiting the same recipe
-- twice would see it split two different ways, which is incoherent whatever the
-- accuracy, and blending on top of a shifting partition would produce a different
-- dish each time somebody looked.
--
-- Same shape as `palate_notes`: keyed on the ingredient lines it was computed from,
-- so an edit recomputes and nothing else does. Derived from the input rather than
-- stamped by hand, because a stamp only works if something turns it.
--
-- ---------------------------------------------------------------------------
-- Storing also makes the number improvable
-- ---------------------------------------------------------------------------
--
-- A stored partition can be recomputed when detection improves — a backfill over
-- recipes whose `components_key` predates the change. Inferring live cannot be
-- improved; it can only be re-rolled, and a re-roll is as likely to be worse.
--
-- **Today's number is a floor, not a verdict.** Section coverage grows only on new
-- imports (`recipe_ingredients.section` landed yesterday), and sections take `right`
-- from ~14 to 25 of thirty. Every import from now on carries evidence the measured
-- corpus did not have, so the same inference improves passively as Stephen imports —
-- without a line of code changing.
-- ---------------------------------------------------------------------------

alter table public.recipes
  add column components jsonb,
  add column components_key text,
  -- how much three independent runs agreed on the stored partition, 0..1. A low
  -- number is not a wrong answer; it is a partition nobody should build on yet.
  add column components_agreement numeric
    check (components_agreement is null or (components_agreement >= 0 and components_agreement <= 1));

comment on column public.recipes.components is
  'Inferred components (§60): [{name, from, to, role}] over ingredient positions. Derived, not authored — safe to delete, recomputed on next view.';
comment on column public.recipes.components_key is
  'Fingerprint of the ingredient lines these components were computed from. Differs after an edit, which is the only time they need recomputing.';
comment on column public.recipes.components_agreement is
  'Pairwise agreement among the runs that produced this partition. Low means the inference was unstable on this recipe, which is a fact about confidence rather than a failure.';

/*
 * Writable by the household, like `palate_notes` and unlike `classified_at`.
 *
 * This is a cache of a derived reading, not a fact about the household and not a cursor another
 * job depends on. The worst a client can do is write itself a wrong partition of its own recipe,
 * which editing the ingredients already allows.
 */
grant insert (components, components_key, components_agreement),
      update (components, components_key, components_agreement)
  on public.recipes to authenticated;

do $do$
begin
  if not has_column_privilege('authenticated', 'public.recipes'::regclass, 'components', 'UPDATE') then
    raise exception 'the recipe page cannot cache the components it computed';
  end if;
  if has_column_privilege('anon', 'public.recipes'::regclass, 'components', 'UPDATE') then
    raise exception 'anon can write components';
  end if;
  -- the matrix has not widened sideways while being added to
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'classified_at', 'UPDATE') then
    raise exception 'a client can re-stamp classified_at';
  end if;
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'updated_at', 'UPDATE') then
    raise exception 'authenticated can stamp its own updated_at';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
