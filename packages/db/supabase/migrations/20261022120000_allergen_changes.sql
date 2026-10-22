/*
 * ---------------------------------------------------------------------------
 * Who changed what this household avoids, and when
 * ---------------------------------------------------------------------------
 *
 * §87 ended with a question nobody could answer. The Lundalls' avoided-allergen list held
 * `["peanut","wheat"]` on 17 October and was empty by the time anyone looked. The cause was
 * found — an invited member's read resolved the column as absent and the control PATCHed that
 * empty array back — but **who** made that write is not recoverable: `updated_at` had been
 * overwritten by a later, unrelated write, and Postgres keeps no history of a column.
 *
 * So the honest answer in the report was "attribution is not available", and the right response
 * to that is a table rather than a better guess. This is that table.
 *
 * ---------------------------------------------------------------------------
 * A trigger, not a route, and that is the whole point
 * ---------------------------------------------------------------------------
 *
 * The write that caused §87 came from a path nobody was looking at. A log written by the route
 * that was *meant* to change allergens would have recorded nothing, because the route that
 * actually did it was the one doing something else. So the log is a **trigger on the column**:
 * every UPDATE that changes `avoided_allergens` is recorded, whatever wrote it, including a
 * service-role write, a migration, or a hand-run statement in a console.
 *
 * Same reasoning as `propagate_soft_delete` living in a trigger rather than in route code
 * (§30): the thing that must not be skippable cannot live where a caller chooses whether to
 * call it.
 *
 * ---------------------------------------------------------------------------
 * The actor, which a trigger cannot know on its own
 * ---------------------------------------------------------------------------
 *
 * `auth.uid()` is null under `service_role`, and the seam writes as the service role — that is
 * the whole reason the platform tables are reachable only through it. So the seam has to say who
 * it is acting for, and it does that through `public.change_avoided_allergen`, a function that
 * performs the read-modify-write **and** stamps the actor into a transaction-local setting the
 * trigger reads.
 *
 * Two things come free with that function and neither is the audit:
 *
 *   - **The lost update goes away.** `changeAvoidedAllergen` was a SELECT and then an UPDATE as
 *     two separate PostgREST calls, so two people toggling at once could each read the same list
 *     and the second write would discard the first's change. One statement cannot do that.
 *   - **The delta stays a delta all the way down.** §87's fix made the control send
 *     `{addAllergen}` instead of the whole array; this makes the *database* do the same, so the
 *     full array never exists on the client side of any boundary.
 *
 * `changed_by` stays **nullable** rather than NOT NULL. A write from a console or a future
 * migration genuinely has no actor, and refusing it would mean the choice between recording the
 * change without a name and not recording it at all — "a change happened and nobody knows who"
 * is exactly the fact that was missing, so it is worth a row.
 */

create table public.allergen_changes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,

  /*
   * One row per allergen per change, not one row per list.
   *
   * A row saying `peanut removed` answers the question that was asked. A row holding the before
   * and after arrays makes the reader diff two lists to find out, which is the work this table
   * exists to have already done. A single UPDATE touching three allergens writes three rows.
   */
  allergen text not null check (length(btrim(allergen)) > 0),
  action text not null check (action in ('added', 'removed')),

  /*
   * The account that asked for it, where one said so. Null means the change arrived through a
   * path with no actor — a console, a migration, a service-role write that did not identify
   * itself — and that is a fact worth recording rather than a reason to refuse the row.
   *
   * `on delete set null`, never cascade: deleting an account must not erase the history of what
   * was done to a household's safety setting. The household outlives the login.
   */
  changed_by uuid references public.accounts (id) on delete set null,

  /*
   * `clock_timestamp()`, not `now()`.
   *
   * `now()` is **transaction** time, so several changes in one transaction all carry the same
   * stamp and cannot be put in order. The first probe of this table showed exactly that: four
   * rows, four distinct events, one identical timestamp. An audit log whose rows cannot be
   * ordered is answering "what changed" and not "what happened when", which is half the question.
   */
  changed_at timestamptz not null default clock_timestamp()
);

/*
 * No `updated_at`, no `deleted_at`, and no unique constraint.
 *
 * Append-only: a row here is a statement about something that happened, and a thing that
 * happened cannot later not have happened. The absence of `deleted_at` is also why the soft
 * delete propagation triggers every other household table carries are absent here — there is
 * nothing to tombstone. A household's hard deletion takes the rows with it through the FK.
 */
comment on table public.allergen_changes is
  'Append-only log of changes to families.avoided_allergens, written by a trigger so no write path can skip it (§88). changed_by is null where the writer did not identify itself.';

create index allergen_changes_household on public.allergen_changes (family_id, changed_at desc);

/*
 * Nobody reads this from the app, so nobody is granted anything.
 *
 * It answers a support question — "who changed this?" — asked by a person holding the service
 * role, not by a screen. Granting `authenticated` a read would publish, to every member, a list
 * of which member changed a safety setting and when, which is a feature nobody has asked for and
 * a surface nobody has designed. When a screen wants it, that is a decision with a design, and
 * the grant arrives then.
 *
 * RLS is enabled with **no policies**, which denies by default — and the grants are revoked as
 * well, because Postgres checks table privileges before row-level security and the two are not
 * the same thing.
 */
alter table public.allergen_changes enable row level security;
revoke all on public.allergen_changes from anon, authenticated;
grant select, insert on public.allergen_changes to service_role;

/*
 * The trigger. Diffs the two arrays and writes a row per difference.
 *
 * `coalesce(..., '{}')` on both sides because the column is NOT NULL today and a diff written
 * against a nullable past is one fewer thing to be wrong about later.
 */
create or replace function private.log_allergen_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid;
  before_list text[] := coalesce(old.avoided_allergens, '{}');
  after_list text[] := coalesce(new.avoided_allergens, '{}');
  item text;
begin
  /*
   * Who, in order of how much the claim is worth: an actor the caller stamped explicitly, then
   * the signed-in user if there is one, then nobody. `current_setting(..., true)` returns null
   * rather than raising when the setting has never been set in this session.
   */
  begin
    actor := nullif(current_setting('pashki.actor', true), '')::uuid;
  exception when others then
    actor := null;
  end;
  if actor is null then
    actor := auth.uid();
  end if;

  foreach item in array after_list loop
    if not (item = any (before_list)) then
      insert into public.allergen_changes (family_id, allergen, action, changed_by)
      values (new.id, item, 'added', actor);
    end if;
  end loop;

  foreach item in array before_list loop
    if not (item = any (after_list)) then
      insert into public.allergen_changes (family_id, allergen, action, changed_by)
      values (new.id, item, 'removed', actor);
    end if;
  end loop;

  return new;
end;
$$;

create trigger log_allergen_change
  after update of avoided_allergens on public.families
  for each row
  when (old.avoided_allergens is distinct from new.avoided_allergens)
  execute function private.log_allergen_change();

/*
 * One allergen on or off, atomically, with the actor named.
 *
 * `public` because PostgREST only exposes functions in the schemas it is configured with, and
 * the seam reaches this through `rpc()`. Execute is revoked from every client role: only the
 * service role may call it, which is the same boundary `families` itself sits behind.
 *
 * Returns the stored list so the caller does not have to read it back — a second round trip
 * would reintroduce the gap between what was written and what is reported.
 */
create or replace function public.change_avoided_allergen(
  p_family_id uuid,
  p_allergen text,
  p_action text,
  p_actor uuid
)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated text[];
begin
  if p_action not in ('add', 'remove') then
    raise exception 'action must be add or remove, not %', p_action;
  end if;
  if length(btrim(coalesce(p_allergen, ''))) = 0 then
    raise exception 'an allergen is required';
  end if;

  /*
   * Transaction-local, so it cannot leak into the next request on a pooled connection — the
   * trigger reads it within this statement's transaction and nowhere else.
   */
  perform set_config('pashki.actor', coalesce(p_actor::text, ''), true);

  /*
   * Deduplicated and sorted, matching what the seam did in TypeScript: no constraint forbids
   * duplicates and the matcher reads this as a set, but storing them makes two identical
   * settings compare unequal, and a screen that round-trips its own value should get it back
   * unchanged.
   */
  update public.families f
  set avoided_allergens = (
    select coalesce(array_agg(distinct a order by a), '{}')
    from unnest(
      case
        when p_action = 'add' then f.avoided_allergens || p_allergen
        else array_remove(f.avoided_allergens, p_allergen)
      end
    ) as a
  )
  where f.id = p_family_id and f.deleted_at is null
  returning f.avoided_allergens into updated;

  if not found then
    raise exception 'no such household';
  end if;

  /*
   * Cleared immediately, which the first probe of this table proved is not optional.
   *
   * `set_config(..., true)` is transaction-local, so it outlives the statement that set it. A
   * bare `UPDATE families SET avoided_allergens = ...` two statements later — a migration, a
   * console — was logged as having been made by **this** actor, who had nothing to do with it.
   * In production each PostgREST call is its own transaction so it would not have happened; "it
   * would not have happened" is not a property of the function.
   *
   * A wrong name in an audit log is worse than no name, because no name is visibly unknown and a
   * wrong one is not.
   */
  perform set_config('pashki.actor', '', true);

  return updated;
end;
$$;

revoke all on function public.change_avoided_allergen(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.change_avoided_allergen(uuid, text, text, uuid) to service_role;

/*
 * The invariant: the log cannot be made readable or writable by a client, and the trigger
 * cannot be removed, without this failing.
 *
 * Modelled on `assert_blends_never_public` for the same reason it exists: the costly version of
 * this mistake is a later migration widening a grant for an unrelated screen and nobody
 * remembering that this table carries who-did-what about a safety setting.
 */
create or replace function private.assert_allergen_changes_are_logged_and_private()
returns void
language plpgsql
as $$
declare
  leaked text;
  n int;
begin
  select string_agg(distinct grantee || ':' || privilege_type, ', ')
  into leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'allergen_changes'
    and grantee in ('anon', 'authenticated');
  if leaked is not null then
    raise exception 'allergen_changes is reachable by a client (%) — it records who changed a safety setting and has no screen', leaked;
  end if;

  select count(*) into n
  from pg_trigger
  where tgrelid = 'public.families'::regclass
    and tgname = 'log_allergen_change'
    and not tgisinternal;
  if n <> 1 then
    raise exception 'the allergen change log trigger is not on families: a write path that skips it is the exact failure this exists for';
  end if;

  /*
   * And the column it watches is still an array on `families`. If allergens ever move — to the
   * member, say, which §71 explicitly decided against — this assertion should fail loudly rather
   * than silently watch a column nothing writes.
   */
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'families' and column_name = 'avoided_allergens';
  if n <> 1 then
    raise exception 'families.avoided_allergens is gone, so the change log is watching nothing';
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
end;
$outer$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
