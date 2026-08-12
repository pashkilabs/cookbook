import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
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
  memberId: string;
  recipeId: string;
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

      const recipe = await admin
        .from("recipes")
        .insert({ family_id: familyId, title: `${label} carbonara` })
        .select("id")
        .single();
      if (recipe.error) throw recipe.error;

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
        memberId: member.data.id as string,
        recipeId: recipe.data.id as string,
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

    it("sees only its own household when listing everything", async () => {
      const { data, error } = await alpha.client.from("recipes").select("family_id");
      expect(error).toBeNull();
      expect(data?.length).toBeGreaterThan(0);
      expect(new Set(data?.map((row) => row.family_id))).toEqual(new Set([alpha.familyId]));
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
      const { data, error } = await alpha.client
        .from("recipes")
        .delete()
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
        .insert({ canonical_name: "smuggled", aisle: "x", dimension: "weight" });
      expect(error?.code).toBe(RLS_VIOLATION);
    });
  });

  describe("import_cache", () => {
    it("is invisible to a signed-in client despite having no household", async () => {
      // shared across the whole user base, so it is served only through the
      // import service running as the service role
      const { data, error } = await alpha.client.from("import_cache").select("url_hash");
      expect(error).toBeNull();
      expect(data).toEqual([]);
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
