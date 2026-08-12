import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * A screenshot job's `input_ref` is a storage path, and the worker that resolves it runs
 * on the service role.
 *
 * Same shape as `photos.storage_path`: a client-supplied reference that something
 * privileged dereferences. Nothing scoped it to the submitting household, so a job could
 * name another household's object and have the extraction result written where the
 * submitter could read it.
 *
 * Not exploitable when this was written — the runner refuses screenshot and video kinds
 * outright — which is the point. The constraint is here so that wiring tier 3 to the
 * queue is not also, accidentally, shipping a cross-household read.
 */
const instance = readLocalInstance();
const CHECK_VIOLATION = "23514";

describe.skipIf(instance === null)("what an import job may point at", () => {
  let admin: SupabaseClient;
  let alpha: TestHousehold;
  let beta: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    alpha = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "ref-alpha",
    });
    beta = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "ref-beta",
    });
  });

  afterAll(async () => {
    if (!instance) return;
    for (const household of [beta, alpha].filter(Boolean)) {
      await deleteTestHousehold(admin, household);
    }
  });

  it("refuses a screenshot job naming another household's object", async () => {
    // regression: the worker bypasses RLS, so a path is only as safe as the row is
    const { error } = await alpha.client.from("import_jobs").insert({
      family_id: alpha.familyId,
      kind: "screenshot",
      input_ref: `${beta.familyId}/their-kitchen.jpg`,
    });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("refuses it from the service role too, because the row is what gets trusted", async () => {
    const { error } = await admin.from("import_jobs").insert({
      family_id: alpha.familyId,
      kind: "video",
      input_ref: `${beta.familyId}/their-video.mp4`,
    });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("accepts a screenshot in the household's own folder", async () => {
    const { error } = await alpha.client.from("import_jobs").insert({
      family_id: alpha.familyId,
      kind: "screenshot",
      input_ref: `${alpha.familyId}/my-reel.jpg`,
    });
    expect(error).toBeNull();
  });

  it("leaves a url job alone, because a URL is not ours to scope", async () => {
    // the guard for those is in packages/import, where a URL can be resolved
    const { error } = await alpha.client.from("import_jobs").insert({
      family_id: alpha.familyId,
      kind: "url",
      input_ref: "https://example.com/recipes/carbonara",
    });
    expect(error).toBeNull();
  });
});

describe.skipIf(instance !== null)("what an import job may point at (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
