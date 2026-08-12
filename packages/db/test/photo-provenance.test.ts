import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * `photos.source` decides whether anon may see a photograph on a published recipe:
 * 'camera' is the household's own, 'import' is the blogger's and stays private.
 *
 * Which makes it provenance rather than a preference, and provenance is asserted by
 * whoever ingested the bytes. A client held table-wide UPDATE, so flipping the flag was
 * one call — and the imported photograph became world-readable.
 */
const instance = readLocalInstance();
const NO_PRIVILEGE = "42501";

describe.skipIf(instance === null)("photo provenance", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let household: TestHousehold;
  let importedPhotoId: string;
  let publicRecipeId: string;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anon = createClient(instance.url, instance.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "provenance",
    });

    const recipe = await admin
      .from("recipes")
      .insert({
        family_id: household.familyId,
        title: "published pie",
        visibility: "public",
      })
      .select("id")
      .single();
    if (recipe.error) throw recipe.error;
    publicRecipeId = recipe.data.id;

    // what the import service writes: the original site's photograph
    const photo = await admin
      .from("photos")
      .insert({
        family_id: household.familyId,
        recipe_id: publicRecipeId,
        storage_path: `${household.familyId}/blogger.jpg`,
        source: "import",
      })
      .select("id")
      .single();
    if (photo.error) throw photo.error;
    importedPhotoId = photo.data.id;
  });

  afterAll(async () => {
    if (!instance) return;
    if (household) await deleteTestHousehold(admin, household);
  });

  it("refuses to relabel an imported photograph as the household's own", async () => {
    // regression: one column write republished a photograph fetched from someone else's
    // site, because the anon policy trusts this flag
    const { error } = await household.client
      .from("photos")
      .update({ source: "camera" })
      .eq("id", importedPhotoId);
    expect(error?.code).toBe(NO_PRIVILEGE);
  });

  it("keeps the imported photograph invisible to anon", async () => {
    const { data, error } = await anon.from("photos").select("id").eq("id", importedPhotoId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("refuses to repoint a row at different bytes", async () => {
    const { error } = await household.client
      .from("photos")
      .update({ storage_path: `${household.familyId}/other.jpg` })
      .eq("id", importedPhotoId);
    expect(error?.code).toBe(NO_PRIVILEGE);
  });

  it("refuses to move a photograph onto another recipe", async () => {
    const { error } = await household.client
      .from("photos")
      .update({ recipe_id: publicRecipeId })
      .eq("id", importedPhotoId);
    expect(error?.code).toBe(NO_PRIVILEGE);
  });

  it("refuses to restate the dimensions the ingest measured", async () => {
    const { error } = await household.client
      .from("photos")
      .update({ width: 4000, height: 4000 })
      .eq("id", importedPhotoId);
    expect(error?.code).toBe(NO_PRIVILEGE);
  });

  it("still lets a household take its own photograph", async () => {
    // labelling a camera photo at insert is honest; it is relabelling that is not
    const { error } = await household.client.from("photos").insert({
      family_id: household.familyId,
      recipe_id: publicRecipeId,
      storage_path: `${household.familyId}/mine.jpg`,
      source: "camera",
      upload_state: "pending",
    });
    expect(error).toBeNull();
  });

  it("still lets a household mark its own bytes uploaded, and remove the photo", async () => {
    const uploaded = await household.client
      .from("photos")
      .update({ upload_state: "stored" })
      .eq("storage_path", `${household.familyId}/mine.jpg`);
    expect(uploaded.error).toBeNull();

    const removed = await household.client
      .from("photos")
      .update({ deleted_at: new Date().toISOString() })
      .eq("storage_path", `${household.familyId}/mine.jpg`);
    expect(removed.error).toBeNull();
  });
});

describe.skipIf(instance !== null)("photo provenance (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
