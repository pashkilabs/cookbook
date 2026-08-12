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

## The seeded catalog

```bash
pnpm --filter @pashki/db gen:seed    # SEED_CATALOG -> supabase/seed.sql
```

`supabase/seed.sql` is **generated** — 55 ingredients, 97 package sizes — and
never hand-edited. `db reset` applies it after the migrations. A hand-copy would
drift the first time someone corrected a grams-per-cup figure in one place and not
the other, and a drifted seed is worse than none: the round-trip test would be
comparing the database against itself.

Re-running the seed upserts rather than duplicating, on `ingredients.key` and
`(ingredient_id, label)`. A package size removed from `SEED_CATALOG` is deleted
here too, or the catalog would keep offering a size that no longer exists.

`test/catalog-roundtrip.test.ts` rebuilds `CatalogItem[]` from the two tables and
asserts it *behaves* identically to `createCatalog(SEED_CATALOG)` — same matches,
same aisles, same package order, and a byte-identical shopping list over a week
that touches every dimension the catalog carries. Behaviour rather than rows,
because two catalogs with identical rows in a different order still pick different
packages, and rows are what a hand-written seed gets right while behaviour drifts.

This is what `grams_per_cup` and `can_size` exist for. Nulling either one in the
database fails the week's consolidation, not just a field comparison — verified by
mutating them deliberately.

**`ingredients.key` is the domain's stable identifier**, surfacing as
`ShoppingLine.key`. It is not a slug of the display name: key `butter` carries
canonical_name `unsalted butter`, so a round-trip through `canonical_name` alone
would silently renumber every shopping line.

After this task, `scripts/check-seed-catalog-usage.mjs` (wired into `pnpm check`)
fails the build if anything outside the definition, seeding and tests references
`SEED_CATALOG`. The catalog is data.

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
insert, update, delete — keyed on the same predicate:

```sql
family_id in (select private.current_family_ids())
```

Writes carry a second predicate, `private.household_can_write(family_id, 'recipes')`,
which is what makes read-only degradation a guarantee instead of a UI convention.
**No SELECT policy references it**, so there is no code path that could deny a read
— read-only is the floor by construction. A migration self-check asserts both
halves: that no SELECT policy consults the entitlement window, and that no write
policy forgets to.

An update by a lapsed household fails loudly with `42501`; a delete is refused
quietly, because DELETE has no `with check` clause to fail. The service role
bypasses RLS, so issuance and the import service keep working for a household that
cannot write.

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

### Proving the tests prove something

```bash
pnpm --filter @pashki/db test:mutate
```

A passing isolation test is worthless if it would also pass against a table with
RLS switched off. `scripts/mutate-rls.sh` weakens one policy at a time and
requires the test meant to catch it to fail. Ten mutations, each with a stated
expectation, including one that drops the entitlement check from a write policy.

The harness also asserts that each filter selected **exactly one** test before it
believes an outcome. `vitest -t` joins describe blocks with a space, not `" > "`,
and a filter that matches nothing exits 0 — which would read as "the mutation was
not caught". It reported exactly that once, on a filter written with `" > "`.

Two findings from building it, both counter-intuitive enough to be worth keeping:

**Dropping a policy makes a table more restrictive, not less.** RLS denies by
default, so removing the SELECT policy means *nothing* is readable — and a test
asserting "cannot read another household" still passes. The mutation that proves a
negative test has teeth is making the policy **permissive**, not removing it.

**Postgres checks the new row of an UPDATE against SELECT policies.** Not just the
UPDATE policy's `WITH CHECK`. So while the SELECT policy is restrictive it masks
the UPDATE policy completely: weakening UPDATE alone changes no observable
behaviour, and both UPDATE tests keep passing. The harness records those two as
`masked`, then runs the layered mutation — SELECT *and* UPDATE permissive together
— which is caught.

That masking is a live risk rather than a curiosity. **Phase 2 adds public,
indexable recipe pages.** If that work loosens the SELECT policy on `recipes`, the
UPDATE policy stops being redundant and becomes the only thing standing between a
household and another household's rows. Re-run `test:mutate` after any change to a
SELECT policy, and expect the two `masked` rows to flip to `catch`.

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

**`src/database.types.ts` is generated, never hand-edited.** Regenerate after any
migration; `gen:types` immediately after a `db:reset` should produce no diff.


**Nothing creates an `accounts` row on signup.** No trigger on `auth.users`.
Account provisioning is `platform-client`'s job (next task), and putting it in a
trigger would make signup side-effects invisible to the seam. The isolation tests
insert the row explicitly for this reason.

**`accounts.id` is `auth.users.id`.** The alternative — a surrogate key plus
`auth_user_id` — would add a hop inside every policy on every table, forever, to
buy portability away from an auth provider already committed to in decisions §5.

**No seed data.** Seeding the catalog from `SEED_CATALOG` is a separate roadmap
task.
