import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * `photos.storage_path` is the join between a storage object and a household.
 *
 * The storage policies deliberately consult the `photos` row rather than parsing the
 * path, so that a renamed convention cannot leave a policy silently matching the old
 * shape. The cost of that choice is that **the row is authoritative about which object
 * it names** — and clients can write rows. Nothing tied a row's path to its own
 * household, so a household could name another household's object and inherit read
 * access to it.
 *
 * These are the constraints that make the row trustworthy enough for a policy to
 * believe it, plus the states a photo taken offline passes through.
 */
const instance = readLocalInstance();
const BUCKET = "recipe-photos";

describe.skipIf(instance === null)("photo storage paths", () => {
  let admin: SupabaseClient;
  let alpha: TestHousehold;
  let beta: TestHousehold;
  let alphaRecipeId: string;
  let betaRecipeId: string;
  /** an object that really exists, in beta's folder */
  let betaObjectPath: string;
  const uploaded: string[] = [];

  const pathFor = (household: TestHousehold, name: string) => `${household.familyId}/${name}`;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    alpha = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "photo-alpha",
    });
    beta = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "photo-beta",
    });

    for (const [household, into] of [
      [alpha, "alpha"],
      [beta, "beta"],
    ] as const) {
      const recipe = await admin
        .from("recipes")
        .insert({ family_id: household.familyId, title: `${into} pie` })
        .select("id")
        .single();
      if (recipe.error) throw recipe.error;
      if (into === "alpha") alphaRecipeId = recipe.data.id;
      else betaRecipeId = recipe.data.id;
    }

    betaObjectPath = pathFor(beta, "private.jpg");
    const upload = await admin.storage
      .from(BUCKET)
      .upload(betaObjectPath, new Uint8Array([1, 2, 3, 4]), { contentType: "image/jpeg" });
    if (upload.error) throw upload.error;
    uploaded.push(betaObjectPath);
  });

  afterAll(async () => {
    if (!instance) return;
    // storage rows cannot be deleted with SQL: storage.protect_delete() refuses it
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    for (const household of [beta, alpha].filter(Boolean)) {
      await deleteTestHousehold(admin, household);
    }
  });

  it("refuses a photo row naming an object outside its own household", async () => {
    // regression: the storage policy trusts the row, so an unconstrained path let a
    // household claim another household's object and read it
    const { error } = await alpha.client.from("photos").insert({
      family_id: alpha.familyId,
      recipe_id: alphaRecipeId,
      storage_path: betaObjectPath,
      source: "camera",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("keeps another household's object unreadable even to the service role's own row", async () => {
    // regression: the same claim written by a caller that bypasses RLS. The constraint
    // has to be the guard, because the row is what the policy believes.
    const { error } = await admin.from("photos").insert({
      family_id: alpha.familyId,
      recipe_id: alphaRecipeId,
      storage_path: betaObjectPath,
      source: "camera",
    });
    expect(error?.code).toBe("23514");

    const download = await alpha.client.storage.from(BUCKET).download(betaObjectPath);
    expect(download.error).not.toBeNull();
  });

  it("refuses two rows claiming the same object", async () => {
    // one object, one row: otherwise deleting one row leaves the object authorised by
    // the other, and a household could attach its own row to a published photo
    const path = pathFor(alpha, "shared.jpg");
    const first = await admin.from("photos").insert({
      family_id: alpha.familyId,
      recipe_id: alphaRecipeId,
      storage_path: path,
      source: "camera",
    });
    expect(first.error).toBeNull();

    const second = await admin.from("photos").insert({
      family_id: alpha.familyId,
      recipe_id: alphaRecipeId,
      storage_path: path,
      source: "camera",
    });
    expect(second.error?.code).toBe("23505");
  });

  it("accepts its own household's folder", async () => {
    const { error } = await beta.client.from("photos").insert({
      family_id: beta.familyId,
      recipe_id: betaRecipeId,
      storage_path: pathFor(beta, "own.jpg"),
      source: "camera",
    });
    expect(error).toBeNull();
  });

  describe("a photo taken offline", () => {
    it("is stored by default, because every path that exists today has its object", async () => {
      const { data, error } = await admin
        .from("photos")
        .insert({
          family_id: alpha.familyId,
          recipe_id: alphaRecipeId,
          storage_path: pathFor(alpha, "default-state.jpg"),
          source: "import",
        })
        .select("upload_state")
        .single();
      expect(error).toBeNull();
      expect(data?.upload_state).toBe("stored");
    });

    it("can name the path its bytes will occupy before they are uploaded", async () => {
      // the path is derivable at capture — family_id and a locally minted uuid — so it
      // is final from the start and a second device knows where to look
      const { error } = await alpha.client.from("photos").insert({
        family_id: alpha.familyId,
        recipe_id: alphaRecipeId,
        storage_path: pathFor(alpha, "pending.jpg"),
        source: "camera",
        upload_state: "pending",
      });
      expect(error).toBeNull();
    });

    it("authorises nothing while it is pending, because there is no object", async () => {
      const download = await alpha.client.storage
        .from(BUCKET)
        .download(pathFor(alpha, "pending.jpg"));
      expect(download.error).not.toBeNull();
    });

    it("refuses a state nobody defined", async () => {
      const { error } = await admin.from("photos").insert({
        family_id: alpha.familyId,
        recipe_id: alphaRecipeId,
        storage_path: pathFor(alpha, "bad-state.jpg"),
        source: "camera",
        upload_state: "uploading",
      });
      expect(error?.code).toBe("23514");
    });

    it("is found by the uploader without scanning every photo ever taken", async () => {
      const { data, error } = await admin
        .from("photos")
        .select("storage_path")
        .eq("upload_state", "pending")
        .is("deleted_at", null);
      if (error) throw error;
      expect(data?.map((row) => row.storage_path)).toContain(pathFor(alpha, "pending.jpg"));
    });
  });
});

describe.skipIf(instance !== null)("photo storage paths (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
