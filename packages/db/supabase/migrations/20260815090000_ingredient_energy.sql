-- Food energy on the catalog.
--
-- The catalog already knows canonical names and how to convert units, so calories are arithmetic
-- rather than a lookup at render time — `packages/core`'s `estimateEnergy` multiplies grams by a
-- density from these columns. No network call at import or display, and no model.
--
-- **Nullable on purpose, and that is the interesting part.** Coverage is partial and always will
-- be: a catalog cannot hold every ingredient anybody writes. A null here is a real answer that
-- travels all the way to the screen, where a total says "at least ~480 · 3 ingredients unknown"
-- rather than quietly omitting the chorizo and reading as a fact. Decisions §43.

alter table public.ingredients
  add column kcal_per_100g numeric check (kcal_per_100g >= 0),
  -- the USDA FoodData Central id the figure came from, so a wrong number is traceable rather than
  -- folklore. Matching is the hard part: 'butter' returns ghee at 900 above butter at 717, and
  -- 'rice' returns 365 raw against 130 cooked — a threefold difference decided by which row a
  -- person picked. Recording which row makes that reviewable.
  add column energy_fdc_id text,
  -- weight of one, for things counted rather than measured. "2 onions" is unanswerable without it,
  -- and guessing is the silent understatement the whole design avoids.
  add column grams_each numeric check (grams_each > 0);

comment on column public.ingredients.kcal_per_100g is
  'Food energy per 100g, hand-checked against USDA FoodData Central. Null means unknown, which the estimate reports rather than absorbs.';
comment on column public.ingredients.energy_fdc_id is
  'FDC id backing kcal_per_100g. Present so a wrong figure can be traced to the row it came from.';

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
