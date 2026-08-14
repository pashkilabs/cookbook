import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readLocalInstance } from "./local-instance.js";

/**
 * Household isolation, proved against a real Postgres with real JWTs.
 *
 * A happy-path test proves nothing here. Every case below is an attempt by one
 * household to reach another's rows while holding a perfectly valid token — that
 * is the threat, not an unauthenticated request.
 */
const instance = readLocalInstance();

/** RLS denies by filtering, so most attacks look like an empty result, not an error. */
const RLS_VIOLATION = "42501";

interface Household {
  familyId: string;
  accountId: string;
  memberId: string;
  recipeId: string;
  publicRecipeId: string;
  tombstonedRecipeId: string;
  email: string;
  client: SupabaseClient;
}

describe.skipIf(instance === null)("row-level security", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let alpha: Household;
  let beta: Household;
  let ingredientId: string;
  const cacheKey = `sha256:test-${Date.now()}`;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anon = createClient(instance.url, instance.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const stamp = Date.now();

    const build = async (label: string): Promise<Household> => {
      const email = `${label}-${stamp}@pashki.test`;
      const password = `pw-${label}-${stamp}`;

      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      const accountId = created.data.user?.id;
      if (!accountId) throw new Error(`no user id for ${label}`);

      // no trigger creates this row — account provisioning belongs to
      // platform-client, which is a separate task
      const account = await admin.from("accounts").insert({ id: accountId, email });
      if (account.error) throw account.error;

      const family = await admin
        .from("families")
        .insert({ name: `${label} household`, owner_account_id: accountId })
        .select("id")
        .single();
      if (family.error) throw family.error;
      const familyId = family.data.id as string;

      const member = await admin
        .from("family_members")
        .insert({ family_id: familyId, account_id: accountId, display_name: label })
        .select("id")
        .single();
      if (member.error) throw member.error;

      // a live entitlement, so the write tests below are exercising household
      // isolation rather than the new read-only enforcement
      const entitlement = await admin.from("entitlements").insert({
        family_id: familyId,
        app_key: "recipes",
        tier: "full",
        quota_json: { imports: { limit: 100, used: 0, resetsAt: null } },
        valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
        grace_until: new Date(Date.now() + 37 * 86400000).toISOString(),
      });
      if (entitlement.error) throw entitlement.error;

      const recipe = await admin
        .from("recipes")
        .insert({ family_id: familyId, title: `${label} carbonara` })
        .select("id")
        .single();
      if (recipe.error) throw recipe.error;

      const published = await admin
        .from("recipes")
        .insert({
          family_id: familyId,
          title: `${label} published pie`,
          servings: 4,
          time_minutes: 45,
          source_url: "https://example.com/pie",
          source_name: "Example Blog",
          visibility: "public",
          // household signals that must never reach a public reader
          make_again: true,
          times_made: 7,
        })
        .select("id")
        .single();
      if (published.error) throw published.error;

      const tombstoned = await admin
        .from("recipes")
        .insert({
          family_id: familyId,
          title: `${label} deleted thing`,
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (tombstoned.error) throw tombstoned.error;

      const client = createClient(instance.url, instance.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;

      return {
        familyId,
        accountId,
        memberId: member.data.id as string,
        recipeId: recipe.data.id as string,
        publicRecipeId: published.data.id as string,
        tombstonedRecipeId: tombstoned.data.id as string,
        email,
        client,
      };
    };

    alpha = await build("alpha");
    beta = await build("beta");

    const ingredient = await admin
      .from("ingredients")
      .insert({
        key: `test-cream-${stamp}`,
        canonical_name: `test cream ${stamp}`,
        aisle: "dairy",
        dimension: "volume",
      })
      .select("id")
      .single();
    if (ingredient.error) throw ingredient.error;
    ingredientId = ingredient.data.id as string;

    const cached = await admin
      .from("import_cache")
      .insert({ url_hash: cacheKey, extracted_json: { title: "cached" } });
    if (cached.error) throw cached.error;
  });

  afterAll(async () => {
    if (!instance) return;
    // Shared tables first: the catalog and the cache belong to nobody, so anything
    // left is visible to every other test.
    await admin.from("ingredients").delete().eq("id", ingredientId);
    await admin.from("import_cache").delete().eq("url_hash", cacheKey);

    // Households now need clearing too, which they did not before. Publishing makes
    // a recipe visible across households, so a leftover public row from an earlier
    // run shows up in the next run's "what can I see" assertions. Deleting the
    // family cascades its recipes, members and entitlement; the account has to
    // follow separately because families deliberately RESTRICT deleting an owner.
    for (const household of [alpha, beta]) {
      await admin.from("families").delete().eq("id", household.familyId);
      await admin.from("accounts").delete().eq("id", household.accountId);
      await admin.auth.admin.deleteUser(household.accountId);
    }
  });

  describe("reading another household", () => {
    it("sees its own recipe", async () => {
      const { data, error } = await alpha.client
        .from("recipes")
        .select("id, title")
        .eq("id", alpha.recipeId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("cannot read another household's recipe even asking for it by id", async () => {
      const { data, error } = await alpha.client
        .from("recipes")
        .select("id, title")
        .eq("id", beta.recipeId);
      // filtered, not refused — the row simply does not exist for this caller
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("sees its own household plus other households' published recipes, and nothing else", async () => {
      // this used to assert "only its own household". Publishing changed what is
      // true, not just what is tested: a signed-in person following a friend's link
      // has to be able to read it.
      const { data, error } = await alpha.client.from("recipes").select("id, family_id");
      expect(error).toBeNull();

      const foreignIds = data!
        .filter((row) => row.family_id !== alpha.familyId)
        .map((row) => row.id);
      // published: visible. Unpublished: not. Asserted as membership rather than an
      // exact set, because published rows are visible across households and a
      // shared database may hold other households' pages.
      expect(foreignIds).toContain(beta.publicRecipeId);
      expect(foreignIds).not.toContain(beta.recipeId);
      expect(foreignIds).not.toContain(beta.tombstonedRecipeId);
    });

    it("cannot read another household's unpublished recipe", async () => {
      const { data } = await alpha.client
        .from("recipes")
        .select("id")
        .eq("id", beta.recipeId);
      expect(data).toEqual([]);
    });

    it("can read another household's published recipe", async () => {
      const { data, error } = await alpha.client
        .from("recipes")
        .select("id, title")
        .eq("id", beta.publicRecipeId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("cannot read another household's members", async () => {
      const { data } = await alpha.client
        .from("family_members")
        .select("id")
        .eq("family_id", beta.familyId);
      expect(data).toEqual([]);
    });

    it("cannot read another household's account row", async () => {
      const { data } = await alpha.client.from("accounts").select("email");
      expect(data?.map((row) => row.email)).toEqual([alpha.email]);
    });

    it("cannot read another household's family", async () => {
      const { data } = await alpha.client.from("families").select("id").eq("id", beta.familyId);
      expect(data).toEqual([]);
    });
  });

  describe("writing into another household", () => {
    it("cannot update another household's recipe", async () => {
      const { data, error } = await alpha.client
        .from("recipes")
        .update({ title: "owned" })
        .eq("id", beta.recipeId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      // and the row really is untouched
      const { data: actual } = await admin
        .from("recipes")
        .select("title")
        .eq("id", beta.recipeId)
        .single();
      expect(actual?.title).toBe("beta carbonara");
    });

    it("cannot delete another household's recipe", async () => {
      // deletion for a client is a tombstone (091300), so this exercises the UPDATE
      // policy — which is what actually decides isolation now that DELETE is revoked
      const { data, error } = await alpha.client
        .from("recipes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", beta.recipeId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { count } = await admin
        .from("recipes")
        .select("id", { count: "exact", head: true })
        .eq("id", beta.recipeId);
      expect(count).toBe(1);
    });

    it("cannot insert a row into another household", async () => {
      const { error } = await alpha.client
        .from("recipes")
        .insert({ family_id: beta.familyId, title: "planted" });
      expect(error?.code).toBe(RLS_VIOLATION);
    });

    it("cannot hand its own recipe to another household", async () => {
      // the `with check` half of the update policy. Without it, a caller could
      // move rows out of their own household one update at a time.
      const { error } = await alpha.client
        .from("recipes")
        .update({ family_id: beta.familyId })
        .eq("id", alpha.recipeId);
      expect(error?.code).toBe(RLS_VIOLATION);
    });

    it("cannot join another household by adding itself as a member", async () => {
      // the attack that would defeat everything else: family_members is what
      // private.current_family_ids() reads, so a client able to write it could
      // grant itself any household. It is deliberately read-only to clients.
      const { error } = await alpha.client.from("family_members").insert({
        family_id: beta.familyId,
        account_id: alpha.accountId,
        display_name: "intruder",
      });
      expect(error?.code).toBe(RLS_VIOLATION);

      const { count } = await admin
        .from("family_members")
        .select("id", { count: "exact", head: true })
        .eq("family_id", beta.familyId);
      expect(count).toBe(1);
    });

    it("cannot attach a child row to another household's recipe", async () => {
      const { error } = await alpha.client.from("recipe_ingredients").insert({
        family_id: alpha.familyId,
        recipe_id: beta.recipeId,
        position: 0,
        item_text: "1 cup cream",
      });
      // the composite foreign key rejects it before RLS has to: the pair
      // (beta recipe, alpha family) does not exist
      expect(error).not.toBeNull();
    });
  });

  describe("anonymous callers", () => {
    it("reads no household data at all", async () => {
      for (const table of ["recipes", "families", "family_members", "ratings"]) {
        const { data } = await anon.from(table).select("*");
        expect(data ?? [], table).toEqual([]);
      }
    });
  });

  describe("read-only after grace", () => {
    /** Move a household's window into the past. Both dates: grace cannot precede validity. */
    const lapse = async (familyId: string, graceOffsetMs: number) => {
      const { error } = await admin
        .from("entitlements")
        .update({
          valid_until: new Date(Date.now() - 8 * 86400000).toISOString(),
          grace_until: new Date(Date.now() + graceOffsetMs).toISOString(),
        })
        .eq("family_id", familyId);
      if (error) throw error;
    };

    const restore = async (familyId: string) => {
      const { error } = await admin
        .from("entitlements")
        .update({
          valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
          grace_until: new Date(Date.now() + 37 * 86400000).toISOString(),
        })
        .eq("family_id", familyId);
      if (error) throw error;
    };

    it("still reads everything it owns", async () => {
      // decisions §9: a family must not lose access to their own recipes because a
      // card expired mid-shop. This is the half that must keep working.
      await lapse(alpha.familyId, -1);
      try {
        const { data, error } = await alpha.client.from("recipes").select("id, title");
        expect(error).toBeNull();
        expect(data?.length).toBeGreaterThan(0);

        // every household table, not just recipes
        for (const table of ["recipe_ingredients", "ratings", "meal_plans", "pantry_items"]) {
          const result = await alpha.client.from(table).select("id");
          expect(result.error, table).toBeNull();
        }
      } finally {
        await restore(alpha.familyId);
      }
    });

    it("cannot insert", async () => {
      await lapse(alpha.familyId, -1);
      try {
        const { error } = await alpha.client
          .from("recipes")
          .insert({ family_id: alpha.familyId, title: "after grace" });
        expect(error?.code).toBe(RLS_VIOLATION);
      } finally {
        await restore(alpha.familyId);
      }
    });

    it("cannot update", async () => {
      await lapse(alpha.familyId, -1);
      try {
        const { error } = await alpha.client
          .from("recipes")
          .update({ title: "renamed after grace" })
          .eq("id", alpha.recipeId);
        expect(error?.code).toBe(RLS_VIOLATION);

        const { data } = await admin
          .from("recipes")
          .select("title")
          .eq("id", alpha.recipeId)
          .single();
        expect(data?.title).toBe("alpha carbonara");
      } finally {
        await restore(alpha.familyId);
      }
    });

    it("cannot delete", async () => {
      await lapse(alpha.familyId, -1);
      try {
        // This refusal used to be quiet — zero rows — because DELETE has no with-check
        // clause to fail. Since 091300 a client deletes by writing deleted_at, so the
        // entitlement predicate applies and the refusal is loud like every other write.
        const { data, error } = await alpha.client
          .from("recipes")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", alpha.recipeId)
          .select("id");
        expect(error?.code).toBe(RLS_VIOLATION);
        expect(data).toBeNull();

        const { count } = await admin
          .from("recipes")
          .select("id", { count: "exact", head: true })
          .eq("id", alpha.recipeId);
        expect(count).toBe(1);
      } finally {
        await restore(alpha.familyId);
      }
    });

    it("still writes while inside the grace window", async () => {
      // grace means keep working and nag, not stop
      await lapse(alpha.familyId, 60_000);
      try {
        const { error } = await alpha.client
          .from("recipes")
          .insert({ family_id: alpha.familyId, title: "during grace" });
        expect(error).toBeNull();
      } finally {
        await restore(alpha.familyId);
      }
    });

    it("does not affect another household", async () => {
      await lapse(alpha.familyId, -1);
      try {
        const { error } = await beta.client
          .from("recipes")
          .insert({ family_id: beta.familyId, title: "beta unaffected" });
        expect(error).toBeNull();
      } finally {
        await restore(alpha.familyId);
      }
    });

    it("is refused for a household with no entitlement at all", async () => {
      // absence is not an unmetered allowance
      const { error: removed } = await admin
        .from("entitlements")
        .delete()
        .eq("family_id", alpha.familyId);
      if (removed) throw removed;
      try {
        const { error } = await alpha.client
          .from("recipes")
          .insert({ family_id: alpha.familyId, title: "no entitlement" });
        expect(error?.code).toBe(RLS_VIOLATION);
        // and reading is still fine
        const { error: readError } = await alpha.client.from("recipes").select("id");
        expect(readError).toBeNull();
      } finally {
        const { error } = await admin.from("entitlements").insert({
          family_id: alpha.familyId,
          app_key: "recipes",
          tier: "full",
          quota_json: { imports: { limit: 100, used: 0, resetsAt: null } },
          valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
          grace_until: new Date(Date.now() + 37 * 86400000).toISOString(),
        });
        if (error) throw error;
      }
    });
  });

  describe("the revoked public read surface", () => {
    /**
     * §17 shipped a public recipe page's read surface and nothing was ever built to render it.
     * Migration 20260814090000 took it back: a live anon path on a deployed project, for a
     * feature with no users, is risk with no benefit.
     *
     * These tests assert it is **gone**, not that it is currently invisible. RLS denies by
     * default, so a revoked grant and a missing policy produce the same empty answer from a
     * client — and "empty" would also be what a broken fixture produced. Each one therefore
     * checks the mechanism as well as the effect.
     */
    const PUBLIC_COLUMNS = "id, title, servings, time_minutes, source_url, source_name";

    it("refuses a published recipe to anon, on the grant rather than the row", async () => {
      const { data, error } = await anon
        .from("recipes")
        .select(PUBLIC_COLUMNS)
        .eq("id", beta.publicRecipeId);
      // a permission error, not an empty list: the columns are not readable at all now
      expect(error?.code).toBe(RLS_VIOLATION);
      expect(data).toBeNull();
    });

    it("refuses select * as well", async () => {
      const { error } = await anon.from("recipes").select("*");
      expect(error?.code).toBe(RLS_VIOLATION);
    });

    it("refuses the ingredients of a published recipe", async () => {
      const { error } = await anon
        .from("recipe_ingredients")
        .select("item_text")
        .eq("recipe_id", beta.publicRecipeId);
      expect(error?.code).toBe(RLS_VIOLATION);
    });

    it("refuses the photograph of a published recipe", async () => {
      // the household's own camera photo, which was the one anon used to be allowed
      const { error } = await anon.from("photos").select("id, storage_path");
      expect(error?.code).toBe(RLS_VIOLATION);
    });

    /*
     * "anon holds no policy in any schema" is asserted by `private.assert_no_anon_reads()`,
     * folded into `assert_rls_invariants()` so it runs on every future migration rather than
     * only on the one that revoked it. It is not restated here because a client cannot read
     * pg_policy, and a test that could only observe the *effect* would pass just as happily
     * against a fixture that was broken.
     *
     * That assertion earned its place: it caught the storage read path this migration first
     * missed — a policy on `storage.objects` is invisible from `public`, and would have left
     * the bytes of every published photo reachable while the tables above looked revoked.
     */

    it("keeps recipes.visibility, because only the exposure was reversed", async () => {
      // §17 stands; rebuilding the pages is one migration with 090500 as its text
      const { error } = await admin
        .from("recipes")
        .update({ visibility: "public" })
        .eq("id", beta.publicRecipeId);
      expect(error).toBeNull();
    });
  });

  describe("a published recipe is not a writable one", () => {
    it("cannot update another household's public recipe", async () => {
      // Before publishing existed, the SELECT policy hid beta's rows and masked this
      // entirely. Now the row is visible and the UPDATE policy is the only guard.
      const { data, error } = await alpha.client
        .from("recipes")
        .update({ title: "defaced" })
        .eq("id", beta.publicRecipeId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: intact } = await admin
        .from("recipes")
        .select("title")
        .eq("id", beta.publicRecipeId)
        .single();
      expect(intact?.title).toBe("beta published pie");
    });

    it("cannot move its own public recipe into another household", async () => {
      const { error } = await alpha.client
        .from("recipes")
        .update({ family_id: beta.familyId })
        .eq("id", alpha.publicRecipeId);
      expect(error?.code).toBe(RLS_VIOLATION);
    });

    it("cannot delete another household's public recipe", async () => {
      // a visible row is not a writable one, and tombstoning is a write
      const { data, error } = await alpha.client
        .from("recipes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", beta.publicRecipeId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("cannot add an ingredient to another household's public recipe", async () => {
      const { error } = await alpha.client.from("recipe_ingredients").insert({
        family_id: alpha.familyId,
        recipe_id: beta.publicRecipeId,
        position: 99,
        item_text: "1 cup mischief",
      });
      expect(error).not.toBeNull();
    });
  });

  describe("tombstones", () => {
    it("keeps a deleted row readable so the deletion can propagate", async () => {
      // if RLS hid tombstones, a device could not tell "deleted elsewhere" from
      // "not synced yet", and the recipe would come back
      const { data, error } = await alpha.client
        .from("recipes")
        .select("id, deleted_at")
        .eq("id", alpha.tombstonedRecipeId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.deleted_at).not.toBeNull();
    });

    it("still does not leak another household's tombstones", async () => {
      const { data } = await alpha.client
        .from("recipes")
        .select("id")
        .eq("id", beta.tombstonedRecipeId);
      expect(data).toEqual([]);
    });
  });

  describe("the catalog", () => {
    it("is readable by any signed-in household", async () => {
      const { data, error } = await alpha.client
        .from("ingredients")
        .select("id")
        .eq("id", ingredientId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("is not writable by a client", async () => {
      const { error } = await alpha.client
        .from("ingredients")
        // a complete row, so a rejection can only be the missing privilege
        .insert({ key: "smuggled", canonical_name: "smuggled", aisle: "x", dimension: "weight" });
      expect(error?.code).toBe(RLS_VIOLATION);
    });
  });

  describe("import_cache", () => {
    it("is unreachable by a signed-in client despite having no household", async () => {
      // shared across the whole user base, so it is served only through the
      // import service running as the service role.
      //
      // Refused outright rather than filtered to zero rows: authenticated holds no
      // grant on this table, and Postgres checks privileges before RLS. Two
      // independent gates are shut — the missing grant, and RLS enabled with no
      // policy. The migration asserts the second one, because a future `grant
      // select` would open the first without anyone noticing.
      const { data, error } = await alpha.client.from("import_cache").select("url_hash");
      expect(error?.code).toBe(RLS_VIOLATION);
      expect(error?.message).toContain("permission denied");
      expect(data).toBeNull();
    });

    it("is invisible to anonymous callers", async () => {
      const { data } = await anon.from("import_cache").select("url_hash");
      expect(data ?? []).toEqual([]);
    });

    it("is usable by the service role that owns it", async () => {
      const { data, error } = await admin
        .from("import_cache")
        .select("url_hash")
        .eq("url_hash", cacheKey);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  describe("platform tables are read-only to clients", () => {
    it("reads its own account row", async () => {
      const { data, error } = await alpha.client
        .from("accounts")
        .select("id, email")
        .eq("id", alpha.accountId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("cannot write it, and no policy pretends otherwise", async () => {
      // regression: accounts_update_self existed with no matching grant. It decided
      // nothing — and RLS denies by default, so removing it means a future
      // `grant update on accounts` still fails closed rather than silently opening the
      // table (decisions §16, asserted in assert_rls_invariants).
      const { error } = await alpha.client
        .from("accounts")
        .update({ email: "taken-over@example.com" })
        .eq("id", alpha.accountId);
      expect(error?.code).toBe(RLS_VIOLATION);

      const { data } = await admin
        .from("accounts")
        .select("email")
        .eq("id", alpha.accountId)
        .single();
      expect(data?.email).toBe(alpha.email);
    });
  });

  describe("updated_at", () => {
    it("is maintained by the database, not the caller", async () => {
      const before = await admin
        .from("recipes")
        .select("updated_at")
        .eq("id", alpha.recipeId)
        .single();

      const bumped = await alpha.client
        .from("recipes")
        .update({ times_made: 1 })
        .eq("id", alpha.recipeId)
        .select("updated_at")
        .single();

      expect(bumped.error).toBeNull();
      expect(new Date(bumped.data?.updated_at as string).getTime()).toBeGreaterThan(
        new Date(before.data?.updated_at as string).getTime(),
      );
    });
  });
});

describe.skipIf(instance !== null)("row-level security (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
