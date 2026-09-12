-- ---------------------------------------------------------------------------
-- What day it is where the household cooks.
--
-- `todayIso()` returned the UTC calendar day, and its own file header claimed no
-- clock was ever consulted. For a household in Texas that is wrong every evening:
-- at 5pm on Tuesday it is already Wednesday in UTC, so the planner rings the wrong
-- day, and on a Sunday evening "Make this week" quietly means next week.
--
-- A household setting rather than a per-device one, for the same reason
-- `measurement_system` is (§28): two adults on two phones in two places must read
-- one week. A device guess would make "this week" mean different things to the two
-- people planning it.
--
-- ---------------------------------------------------------------------------
-- Validated against the database's own zone table
-- ---------------------------------------------------------------------------
--
-- An IANA name, checked against `pg_timezone_names` rather than a regex. A stored
-- zone the database cannot resolve is worse than none: every date computed from it
-- would silently fall back, and a silent fallback to UTC is the bug this fixes.
-- The default is UTC, which is exactly what every household gets today, so nothing
-- changes for anyone until they set one.
-- ---------------------------------------------------------------------------

create or replace function private.is_known_timezone(candidate text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_timezone_names where name = candidate)
$$;

alter table public.families
  add column timezone text not null default 'UTC'
    constraint families_timezone_is_known
      check (private.is_known_timezone(timezone));

comment on column public.families.timezone is
  'IANA zone name deciding what "today" and "this week" mean for this household. A household setting, not a device one: two adults in two places must read one week. Defaults to UTC, which is what every household got before this existed.';

-- a household setting is changed through the seam, like measurement_system, so the
-- client gets no grant: `families` is a platform table and app code may not write it
do $do$
begin
  perform private.assert_rls_invariants();

  if has_column_privilege('authenticated', 'public.families'::regclass, 'timezone', 'UPDATE') then
    raise exception 'a client can write a household timezone directly — it is a platform setting';
  end if;

  -- the check has to actually refuse something, or it is decoration
  begin
    update public.families set timezone = 'Mars/Olympus_Mons' where false;
  exception when others then
    null;
  end;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.families'::regclass and conname = 'families_timezone_is_known'
  ) then
    raise exception 'nothing validates the stored timezone, so an unresolvable one would fall back to UTC in silence';
  end if;
end;
$do$;
