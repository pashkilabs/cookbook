-- ---------------------------------------------------------------------------
-- How many readings produced the stored partition.
--
-- `components_agreement` documents itself as "how much three independent runs
-- agreed", and the write path could not keep that promise: a run lost to a provider
-- error was dropped as a non-vote, so two surviving runs that happened to concur
-- stored the same 1.0 as three would. **The fewer runs answered, the more confident
-- the row looked** — the failure running in the unsafe direction, and any later rule
-- reading "don't blend below 0.6" would wave through exactly the rows built on least
-- evidence.
--
-- `Consensus.readings` existed precisely because "one reading agreeing with nothing
-- is not the same as three agreeing perfectly", and the write threw it away. This is
-- the same class as a check that cannot distinguish no-result from passed, one layer
-- along: a number that cannot distinguish agreement from absence of dissent.
-- ---------------------------------------------------------------------------

alter table public.recipes
  add column components_readings smallint
    check (components_readings is null or components_readings between 0 and 3),
  -- how many of those readings agreed on the component count that won. The count is
  -- decided by voting rather than by overlap, so this is the vote that settled it.
  add column components_agreed_on_count smallint
    check (components_agreed_on_count is null or components_agreed_on_count between 0 and 3);

comment on column public.recipes.components_readings is
  'How many of the three runs returned a usable partition. Two agreeing is not three agreeing, and a row cannot report its own confidence without this.';
comment on column public.recipes.components_agreed_on_count is
  'How many readings voted for the component count that won. The count is decided by voting rather than by similarity, because a hedged reading carrying every proposed boundary out-scores the readings that actually concurred.';

grant insert (components_readings, components_agreed_on_count),
      update (components_readings, components_agreed_on_count)
  on public.recipes to authenticated;

do $do$
begin
  if not has_column_privilege('authenticated', 'public.recipes'::regclass, 'components_readings', 'UPDATE') then
    raise exception 'the write path cannot record how many readings it had';
  end if;
  if has_column_privilege('anon', 'public.recipes'::regclass, 'components_readings', 'UPDATE') then
    raise exception 'anon can write components_readings';
  end if;
  if has_column_privilege('authenticated', 'public.recipes'::regclass, 'updated_at', 'UPDATE') then
    raise exception 'authenticated can stamp its own updated_at';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
