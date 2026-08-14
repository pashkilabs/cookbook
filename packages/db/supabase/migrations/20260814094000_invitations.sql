-- Inviting the second adult.
--
-- §39 deferred this and was overruled: a two-adult household is the ordinary case, not an edge
-- one. The deferral's reasoning was sound and optimised for the wrong thing — it treated Phase 3's
-- deep link as something to solve first, when the web flow is what people need now and the native
-- app extends it later.
--
-- **The token is never stored.** Only its SHA-256. A leaked backup, a stray log line or a support
-- query over this table yields hashes, and a hash cannot be presented to `accept_invitation`. The
-- token exists in exactly two places: the email, and the URL the invited person clicks.
--
-- Acceptance is one statement, for the same reason `import_finish_job` is (§32): claiming the
-- invitation and adding the member cannot be two writes with a window between them, or a
-- double-clicked link joins a household twice.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- stored lowercased; the unique index and every lookup fold case, because nobody types their
  -- own address the same way twice
  email text not null,
  -- sha256 of the token, hex. Never the token.
  token_hash text not null unique,
  invited_by_account_id uuid references public.accounts (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  -- a second invitation to the same address supersedes the first rather than leaving two live
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint invitations_email_lowercase check (email = lower(email))
);

/*
 * One live invitation per address per household.
 *
 * Expiry is deliberately *not* in this predicate: `now()` is not immutable and cannot appear in
 * an index. So an expired-but-unsuperseded row still occupies the slot, and re-inviting supersedes
 * it explicitly — which is the behaviour wanted anyway, since it leaves a record of both.
 */
create unique index invitations_one_live_per_address
  on public.invitations (family_id, email)
  where accepted_at is null and revoked_at is null and superseded_at is null and deleted_at is null;

create index invitations_family on public.invitations (family_id) where deleted_at is null;

create trigger set_updated_at
  before update on public.invitations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- A platform table: readable by the household, written only by the seam.
-- ---------------------------------------------------------------------------

alter table public.invitations enable row level security;

/*
 * Members of the household may see who has been invited — and **never the token hash**, which is
 * withheld by column grant rather than by remembering to omit it from a select. A hash is not
 * usable, but publishing one to every household member is a gift to an offline attack nobody
 * needs to receive.
 */
create policy invitations_select_in_household on public.invitations
  for select to authenticated
  using (family_id in (select private.current_family_ids()));

grant select (id, family_id, email, expires_at, accepted_at, revoked_at, superseded_at, created_at)
  on public.invitations to authenticated;
grant select, insert, update, delete on public.invitations to service_role;

-- ---------------------------------------------------------------------------
-- Accepting, atomically.
--
-- Every refusal is a distinct answer rather than a boolean, because "this expired" and "this was
-- already used" are different things to tell a person, and a single `false` would make the
-- negative tests unable to tell which rule fired.
-- ---------------------------------------------------------------------------

create or replace function public.accept_invitation(
  p_token_hash text,
  p_account_id uuid,
  p_email text,
  p_display_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed public.invitations;
  existing_member uuid;
  family public.families;
begin
  /*
   * The claim and the check are one statement. `accepted_at is null` in the WHERE clause is what
   * makes this single-use under concurrency: two simultaneous clicks both run this UPDATE, and
   * exactly one of them matches a row.
   */
  update public.invitations i
  set accepted_at = now(), updated_at = now()
  where i.token_hash = p_token_hash
    and i.accepted_at is null
    and i.revoked_at is null
    and i.superseded_at is null
    and i.deleted_at is null
    and i.expires_at > now()
    -- tied to the address it was sent to, so a forwarded link does not admit a stranger
    and i.email = lower(p_email)
  returning i.* into claimed;

  if claimed.id is null then
    /*
     * Say why, without saying anything a caller could not already know. The token is a secret the
     * holder already has; distinguishing "expired" from "already used" tells them nothing new and
     * is the difference between a useful message and a shrug.
     */
    select * into claimed from public.invitations
    where token_hash = p_token_hash and deleted_at is null;

    if claimed.id is null then
      return jsonb_build_object('status', 'unknown');
    elsif claimed.accepted_at is not null then
      return jsonb_build_object('status', 'used');
    elsif claimed.revoked_at is not null then
      return jsonb_build_object('status', 'revoked');
    elsif claimed.superseded_at is not null then
      return jsonb_build_object('status', 'superseded');
    elsif claimed.expires_at <= now() then
      return jsonb_build_object('status', 'expired');
    else
      -- the token is live but was sent to a different address
      return jsonb_build_object('status', 'wrong-address');
    end if;
  end if;

  -- the account row must exist before a member can reference it
  insert into public.accounts (id, email)
  values (p_account_id, lower(p_email))
  on conflict (id) do update set email = excluded.email;

  select id into existing_member
  from public.family_members
  where family_id = claimed.family_id
    and account_id = p_account_id
    and deleted_at is null;

  if existing_member is null then
    /*
     * An adult: `account_id` set, `is_child` false. The household's own entitlement covers its
     * members (§9), so nothing here issues one — an invitation is a membership, not a purchase.
     */
    insert into public.family_members (family_id, account_id, display_name, colour, is_child)
    values (claimed.family_id, p_account_id, p_display_name, null, false)
    returning id into existing_member;
  end if;

  select * into family from public.families where id = claimed.family_id;

  return jsonb_build_object(
    'status', 'joined',
    'familyId', claimed.family_id,
    'familyName', family.name,
    'memberId', existing_member
  );
end;
$$;

comment on function public.accept_invitation is
  'Claim a single-use invitation and join its household, in one statement. Returns {status} — joined, unknown, used, revoked, superseded, expired or wrong-address. Service role only.';

revoke all on function public.accept_invitation(text, uuid, text, text) from public;
revoke all on function public.accept_invitation(text, uuid, text, text) from anon, authenticated;
grant execute on function public.accept_invitation(text, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The invariants, asserted where the next table cannot forget them.
-- ---------------------------------------------------------------------------

/*
 * The same claim, keyed by id instead of token.
 *
 * The provisioning branch never sees the token — it was in an email — but has just confirmed the
 * address the invitation was sent to, which is a stronger binding than a forwardable URL. Written
 * as a wrapper so there is exactly one place that decides what claiming means.
 */
create or replace function public.accept_invitation_by_id(
  p_invitation_id uuid,
  p_account_id uuid,
  p_email text,
  p_display_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  hash text;
begin
  select token_hash into hash
  from public.invitations
  where id = p_invitation_id and deleted_at is null;

  if hash is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  return public.accept_invitation(hash, p_account_id, p_email, p_display_name);
end;
$$;

comment on function public.accept_invitation_by_id is
  'accept_invitation keyed by id, for the provisioning branch which has a confirmed address and no token. Service role only.';

revoke all on function public.accept_invitation_by_id(uuid, uuid, text, text) from public;
revoke all on function public.accept_invitation_by_id(uuid, uuid, text, text) from anon, authenticated;
grant execute on function public.accept_invitation_by_id(uuid, uuid, text, text) to service_role;

do $do$
begin
  if has_table_privilege('authenticated', 'public.invitations', 'INSERT')
     or has_table_privilege('authenticated', 'public.invitations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.invitations', 'DELETE') then
    raise exception 'a client can write invitations; only the seam may';
  end if;

  if has_column_privilege('authenticated', 'public.invitations', 'token_hash', 'SELECT') then
    raise exception 'a client can read invitation token hashes';
  end if;

  if has_table_privilege('anon', 'public.invitations', 'SELECT') then
    raise exception 'anon can read invitations';
  end if;
end;
$do$;

do $do$ begin perform private.assert_rls_invariants(); end; $do$;
