import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "@pashki/db/test-support";
import { decodeImage } from "../src/index.js";
import {
  RECIPE_PHOTO_BUCKET,
  createReviewPhotoUrl,
  storeImportedPhoto,
} from "../src/photo-storage.js";

/**
 * The photo pipeline against real Storage.
 *
 * What `anon` **cannot** reach matters more here than what it can: a public bucket or a
 * policy that only checked `bucket_id` would serve every household's photographs to
 * anyone with a URL, and nothing in the type system would notice.
 */
const instance = readLocalInstance();

async function photoBytes(width: number, height: number): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 31) % 256;
  return new Uint8Array(
    await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer(),
  );
}

describe.skipIf(instance === null)("recipe photo storage", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let member: SupabaseClient;
  let outsider: SupabaseClient;

  let own: TestHousehold;
  let other: TestHousehold;
  let familyId: string;
  let publicRecipeId: string;
  let privateRecipeId: string;
  const stamp = Date.now();
  const created: string[] = [];

  /** Store an object and register a photos row pointing at it. */
  async function storeWithRow(input: {
    familyId: string;
    recipeId: string;
    source: "camera" | "import";
    deleted?: boolean;
  }): Promise<string> {
    const stored = await storeImportedPhoto(
      { familyId: input.familyId, bytes: await photoBytes(300, 200) },
      { supabase: admin },
    );
    if (!stored.ok) throw new Error(`store failed: ${stored.failure.kind}`);
    created.push(stored.storagePath);

    const row = await admin.from("photos").insert({
      family_id: input.familyId,
      recipe_id: input.recipeId,
      storage_path: stored.storagePath,
      source: input.source,
      width: stored.width,
      height: stored.height,
      ...(input.deleted ? { deleted_at: new Date().toISOString() } : {}),
    });
    if (row.error) throw row.error;
    return stored.storagePath;
  }

  const canRead = async (client: SupabaseClient, path: string): Promise<boolean> => {
    const { data, error } = await client.storage.from(RECIPE_PHOTO_BUCKET).download(path);
    return !error && data !== null;
  };

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anon = createClient(instance.url, instance.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // the fixture builder lives in @pashki/db: creating a household writes platform
    // tables, which no other package may do
    own = await createTestHousehold({ admin, url: instance.url, anonKey: instance.anonKey, label: "own" });
    other = await createTestHousehold({ admin, url: instance.url, anonKey: instance.anonKey, label: "other" });
    familyId = own.familyId;
    member = own.client;
    outsider = other.client;

    const published = await admin
      .from("recipes")
      .insert({ family_id: familyId, title: "Published pie", visibility: "public" })
      .select("id")
      .single();
    if (published.error) throw published.error;
    publicRecipeId = published.data.id;

    const unpublished = await admin
      .from("recipes")
      .insert({ family_id: familyId, title: "Private pie" })
      .select("id")
      .single();
    if (unpublished.error) throw unpublished.error;
    privateRecipeId = unpublished.data.id;
  });

  afterAll(async () => {
    if (!instance) return;
    if (created.length > 0) {
      await admin.storage.from(RECIPE_PHOTO_BUCKET).remove(created);
    }
    for (const household of [other, own].filter(Boolean)) {
      await deleteTestHousehold(admin, household);
    }
  });

  describe("resize and store", () => {
    it("stores a resized JPEG and reports where", async () => {
      const stored = await storeImportedPhoto(
        { familyId, bytes: await photoBytes(3000, 2000) },
        { supabase: admin },
      );
      expect(stored.ok).toBe(true);
      if (!stored.ok) return;
      created.push(stored.storagePath);

      expect(stored.storagePath.startsWith(`${familyId}/`)).toBe(true);
      expect(Math.max(stored.width, stored.height)).toBeLessThanOrEqual(1600);
      expect(stored.contentType).toBe("image/jpeg");

      const { data } = await admin.storage.from(RECIPE_PHOTO_BUCKET).download(stored.storagePath);
      const bytes = new Uint8Array(await data!.arrayBuffer());
      // decoded, not declared — the same rule as the rest of the pipeline
      expect(decodeImage(bytes)).toMatchObject({ format: "jpeg", width: stored.width });
    });

    it("does not enlarge a photo that is already small", async () => {
      const stored = await storeImportedPhoto(
        { familyId, bytes: await photoBytes(200, 150) },
        { supabase: admin },
      );
      if (!stored.ok) throw new Error("expected success");
      created.push(stored.storagePath);
      expect([stored.width, stored.height]).toEqual([200, 150]);
    });

    it("reports a typed failure for bytes that are not an image", async () => {
      const stored = await storeImportedPhoto(
        { familyId, bytes: new TextEncoder().encode("<html>404</html>") },
        { supabase: admin },
      );
      expect(stored.ok).toBe(false);
      if (stored.ok) return;
      expect(stored.failure.kind).toBe("not-an-image");
    });

    it("replaces a previous attempt when given the same id", async () => {
      const photoId = `retry-${stamp}`;
      const first = await storeImportedPhoto(
        { familyId, bytes: await photoBytes(300, 300), photoId },
        { supabase: admin },
      );
      const second = await storeImportedPhoto(
        { familyId, bytes: await photoBytes(400, 400), photoId },
        { supabase: admin },
      );
      expect(first.ok && second.ok).toBe(true);
      if (!second.ok) return;
      created.push(second.storagePath);
      // one object, not two orphans
      expect(first.ok && first.storagePath).toBe(second.storagePath);
      const { data } = await admin.storage.from(RECIPE_PHOTO_BUCKET).download(second.storagePath);
      const bytes = new Uint8Array(await data!.arrayBuffer());
      expect(decodeImage(bytes)?.width).toBe(400);
    });
  });

  describe("what anon cannot reach", () => {
    it("cannot read an object with no photos row — an import awaiting review", async () => {
      // the review screen's photo is not saved yet, and must not be public because a
      // path was generated
      const stored = await storeImportedPhoto(
        { familyId, bytes: await photoBytes(300, 200) },
        { supabase: admin },
      );
      if (!stored.ok) throw new Error("expected success");
      created.push(stored.storagePath);
      expect(await canRead(anon, stored.storagePath)).toBe(false);
      expect(await canRead(member, stored.storagePath)).toBe(false);
    });

    it("cannot read a photo of an unpublished recipe", async () => {
      const path = await storeWithRow({
        familyId,
        recipeId: privateRecipeId,
        source: "camera",
      });
      expect(await canRead(anon, path)).toBe(false);
    });

    it("cannot read an imported photograph, even of a published recipe", async () => {
      // the original blogger's picture. Same subset the photos table allows anon.
      const path = await storeWithRow({
        familyId,
        recipeId: publicRecipeId,
        source: "import",
      });
      expect(await canRead(anon, path)).toBe(false);
    });

    it("cannot read a photo whose row was deleted", async () => {
      const path = await storeWithRow({
        familyId,
        recipeId: publicRecipeId,
        source: "camera",
        deleted: true,
      });
      expect(await canRead(anon, path)).toBe(false);
    });

    it("cannot upload", async () => {
      const { error } = await anon.storage
        .from(RECIPE_PHOTO_BUCKET)
        .upload(`${familyId}/planted-${stamp}.jpg`, await photoBytes(100, 100), {
          contentType: "image/jpeg",
        });
      expect(error).not.toBeNull();
    });

    it("cannot delete a published photo", async () => {
      const path = await storeWithRow({
        familyId,
        recipeId: publicRecipeId,
        source: "camera",
      });
      await anon.storage.from(RECIPE_PHOTO_BUCKET).remove([path]);
      // readable by anon, and still there
      expect(await canRead(admin, path)).toBe(true);
    });

    it("lists only the objects it may read, not the whole folder", async () => {
      // listing runs through the same SELECT policy, so anon seeing the one published
      // photo is correct. What matters is that the private ones are absent.
      const publishedPath = await storeWithRow({
        familyId,
        recipeId: publicRecipeId,
        source: "camera",
      });
      const hiddenPath = await storeWithRow({
        familyId,
        recipeId: privateRecipeId,
        source: "camera",
      });

      const { data } = await anon.storage.from(RECIPE_PHOTO_BUCKET).list(familyId);
      const listed = (data ?? []).map((entry) => `${familyId}/${entry.name}`);
      expect(listed).toContain(publishedPath);
      expect(listed).not.toContain(hiddenPath);
    });
  });

  describe("what anon can reach", () => {
    it("reads the household's own photograph of a published recipe", async () => {
      const path = await storeWithRow({
        familyId,
        recipeId: publicRecipeId,
        source: "camera",
      });
      expect(await canRead(anon, path)).toBe(true);
    });
  });

  describe("a signed-in household", () => {
    it("reads its own photos, published or not", async () => {
      const privatePhoto = await storeWithRow({
        familyId,
        recipeId: privateRecipeId,
        source: "camera",
      });
      const importedPhoto = await storeWithRow({
        familyId,
        recipeId: privateRecipeId,
        source: "import",
      });
      expect(await canRead(member, privatePhoto)).toBe(true);
      // its own imported photo is fine: the copyright limit is on publishing it
      expect(await canRead(member, importedPhoto)).toBe(true);
    });

    it("cannot read another household's unpublished photo", async () => {
      const path = await storeWithRow({
        familyId,
        recipeId: privateRecipeId,
        source: "camera",
      });
      expect(await canRead(outsider, path)).toBe(false);
    });

    it("can read another household's published photograph", async () => {
      const path = await storeWithRow({
        familyId,
        recipeId: publicRecipeId,
        source: "camera",
      });
      expect(await canRead(outsider, path)).toBe(true);
    });

    it("cannot upload either", async () => {
      const { error } = await member.storage
        .from(RECIPE_PHOTO_BUCKET)
        .upload(`${familyId}/client-${stamp}.jpg`, await photoBytes(100, 100), {
          contentType: "image/jpeg",
        });
      // camera upload is a Phase 3 concern and will need a policy written deliberately
      expect(error).not.toBeNull();
    });
  });

  describe("the review screen's photo", () => {
    it("is reachable only through a signed URL", async () => {
      const stored = await storeImportedPhoto(
        { familyId, bytes: await photoBytes(300, 200) },
        { supabase: admin },
      );
      if (!stored.ok) throw new Error("expected success");
      created.push(stored.storagePath);

      expect(await canRead(anon, stored.storagePath)).toBe(false);

      const url = await createReviewPhotoUrl(stored.storagePath, { supabase: admin });
      expect(url).toMatch(/token=/);
      const response = await fetch(url!);
      expect(response.status).toBe(200);
    });
  });

  describe("the bucket itself", () => {
    it("is private, so the policies decide rather than the URL", async () => {
      const { data } = await admin.storage.getBucket(RECIPE_PHOTO_BUCKET);
      expect(data?.public).toBe(false);
    });
  });
});

describe.skipIf(instance !== null)("recipe photo storage (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
