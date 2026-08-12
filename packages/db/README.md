# @pashki/db

Schema, migrations and generated types. Household isolation lives here as a
database guarantee rather than as application logic somebody has to remember.

## Commands

```bash
pnpm --filter @pashki/db db:start     # start the local stack (needs Docker)
pnpm --filter @pashki/db db:reset     # drop, re-apply every migration
pnpm --filter @pashki/db gen:types    # regenerate src/database.types.ts
pnpm --filter @pashki/db test         # RLS isolation tests
pnpm --filter @pashki/db db:stop
```

`test` skips itself with a clear message when no local stack is running, so
`pnpm check` still passes on a machine without Docker. The isolation tests are
not faked when they do run — RLS is enforced by Postgres against a real JWT, and
a mocked version would only prove that the mock filters rows.

## Versioned migrations, not declarative schemas

Supabase supports a declarative workflow (`supabase/schemas/` plus
`supabase db diff`), and their docs say plainly that projects leaning on RLS
policies, triggers and views should stay with versioned migrations — `db diff`
does not reliably track policy changes. This schema is almost entirely policies
and triggers, so migrations it is.

Adding a change:

```bash
pnpm --filter @pashki/db exec supabase migration new describe_the_change
# edit the generated file
pnpm --filter @pashki/db db:reset      # applies everything from scratch
pnpm --filter @pashki/db gen:types
```

## Sync-readiness without a sync engine

The engine is unresolved (`docs/decisions.md` §11) and the choice reaches into
the schema, so the schema commits only to what every candidate needs:

| | Why |
|---|---|
| UUID primary keys | a device mints ids offline without asking the server |
| `created_at` / `updated_at` everywhere | `updated_at` by trigger, because a sync engine writing straight to Postgres never runs our code |
| `deleted_at` on anything a device deletes | a deletion is a row a peer can see, not an absence it can't explain |

No publications, no replication slots, no engine-specific extensions. Those are
engine-shaped and would have to be undone.

**Tombstones stay readable.** No policy filters `deleted_at is null`. A deleted
row a peer cannot see is indistinguishable from one that never synced, which is
exactly how a recipe deleted on one phone reappears from another. Hiding
tombstones is the application's job at query time.

## Isolation

Every household table carries `family_id` and gets four policies — select,
insert, update, delete — all keyed on the same predicate:

```sql
family_id in (select private.current_family_ids())
```

Three details that matter:

**`private.current_family_ids()` is `SECURITY DEFINER`.** Policies need to consult
`family_members`, which is itself protected, so a policy querying it as the caller
would re-enter that table's policy and recurse. Running as the owner breaks the
cycle. Its `search_path` is pinned empty and every name fully qualified, which is
what stops a caller shadowing `public` and lifting the whole guarantee.

**The update policy has both `using` and `with check`.** `using` stops a caller
reaching another household's row; `with check` stops them moving one of their own
rows into a household they don't belong to. The second is the one that's easy to
forget, and there's a test for it.

**Policies are generated in a loop.** The security property that matters is that
these tables are treated *identically* — a loop can't give one table a subtly
different predicate. The migration then asserts its own coverage: any table
carrying `family_id` without RLS, or with RLS and no policies, aborts
`db reset` rather than shipping a hole.

### Three tables are deliberately not household-scoped

`ingredients` and `grocery_packages` are the catalog — global reference data.
Cream comes in pints regardless of whose kitchen it is, and copying the catalog
per household would defeat promoting it out of source code. Readable by any
signed-in user, writable only by the service role that seeds it.

`import_cache` is keyed by URL hash and belongs to nobody, so a recipe that goes
round Facebook is fetched once for the entire user base. It has **RLS enabled and
zero policies**, which denies every ordinary client outright while the import
service, running as the service role, bypasses RLS and uses it normally. Enabling
RLS with no policies is not the same as leaving RLS off — off would expose the
table to anyone holding the anon key.

## Platform tables are read-only to clients

App code must not touch them at all, and every mutation — creating a household,
adding a member, registering a device, issuing an entitlement — goes through
`packages/platform-client` using the service role. Giving clients no write path is
the cheap half of enforcing that seam; the other half is discipline in the
application layer.

`accounts` is readable only as your own row. A co-parent's email isn't needed to
render the app — `family_members.display_name` is — so accounts stays private even
within a household.

## Known gaps, deliberately left

**`src/database.types.ts` is not committed, so there are no concrete row types
yet.** Generating it needs a running database, and this machine could not start
one — Docker cannot pull images (see the report accompanying this work). Run
`pnpm --filter @pashki/db db:start && pnpm --filter @pashki/db gen:types` on a
machine where Docker works, then add the six lines quoted at the top of
`src/index.ts`. A hand-written stand-in was deliberately not committed: it would
claim to be generated and drift from the schema without anyone noticing.

**The migrations have not been executed.** They parse cleanly under the real
PostgreSQL 17 grammar — all 91 statements, checked with `libpg-query` — but
parsing is not executing. Foreign keys, the RLS self-check block, and policy
behaviour are unverified. Run `db:reset` first on any machine with Docker.


**Nothing creates an `accounts` row on signup.** No trigger on `auth.users`.
Account provisioning is `platform-client`'s job (next task), and putting it in a
trigger would make signup side-effects invisible to the seam. The isolation tests
insert the row explicitly for this reason.

**`accounts.id` is `auth.users.id`.** The alternative — a surrogate key plus
`auth_user_id` — would add a hop inside every policy on every table, forever, to
buy portability away from an auth provider already committed to in decisions §5.

**No seed data.** Seeding the catalog from `SEED_CATALOG` is a separate roadmap
task.
