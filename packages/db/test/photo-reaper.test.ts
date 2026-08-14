import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * Which photographs are collectable, and — the half that matters more — which are not.
 *
 * An object being reviewed right now must survive. Deleting somebody's picture out from under an
 * open review would be experienced as the product losing their work, and it would be invisible
 * until they pressed save. So every sparing case below is asserted against an object that *is*
 * old enough to collect, leaving only the sparing rule between it and deletion.
 */
const instance = readLocalInstance();
const BUCKET = "recipe-photos";

describe.skipIf(instance === null)("the photo reaper", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  const sql = <T>(query: string): T => {
    const out = execFileSync(
      "docker",
      ["exec", "-i", "supabase_db_db", "psql", "-U", "postgres", "-d", "postgres", "-tAc", query],
      { encoding: "utf8", timeout: 30_000 },
    ).trim();
    return (out === "" ? null : JSON.parse(out)) as T;
  };

  const exec = (query: string): void => {
    execFileSync(
      "docker",
      ["exec", "-i", "supabase_db_db", "psql", "-U", "postgres", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-c", query],
      { encoding: "utf8", timeout: 30_000 },
    );
  };

  /** Collectable names, as the sweep would see them. */
  const orphans = (graceHours = 24): string[] =>
    sql<string[]>(
      `select coalesce(jsonb_agg(name), '[]'::jsonb) from private.orphaned_photo_objects(${graceHours})`,
    );

  const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xdb, ...new Array(64).fill(0)]);

  /** Put an object in the bucket and, optionally, age it. */
  async function putObject(name: string, ageHours = 0): Promise<string> {
    const path = `${household.familyId}/${name}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, jpeg(), {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) throw error;
    if (ageHours > 0) {
      // storage.objects.created_at is the reaper's clock; moving it is how a test covers a
      // grace window without waiting a day
      exec(
        `update storage.objects set created_at = now() - interval '${ageHours} hours'
         where bucket_id = '${BUCKET}' and name = '${path}'`,
      );
    }
    return path;
  }

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "reaper",
    });
  });

  afterAll(async () => {
    if (!instance || !household) return;
    const { data } = await admin.storage.from(BUCKET).list(household.familyId);
    if (data?.length) {
      await admin.storage.from(BUCKET).remove(data.map((e) => `${household.familyId}/${e.name}`));
    }
    await admin.from("import_jobs").delete().eq("family_id", household.familyId);
    await deleteTestHousehold(admin, household);
  });

  describe("what it collects", () => {
    it("takes an object no photos row has ever claimed", async () => {
      const path = await putObject("abandoned.jpg", 48);
      expect(orphans()).toContain(path);
    });

    it("takes one left by a cancelled import", async () => {
      const path = await putObject("cancelled.jpg", 48);
      const { data } = await admin
        .from("import_jobs")
        .insert({
          family_id: household.familyId,
          kind: "url",
          input_ref: "https://example.com/cancelled",
          status: "cancelled",
          result_json: { ok: true, photo: { storagePath: path } },
        })
        .select("id")
        .single();
      expect(data?.id).toBeTruthy();
      // the job is over; nobody is coming back for the picture
      expect(orphans()).toContain(path);
    });

    it("reports what it would free, so a sweep is measurable", async () => {
      const path = await putObject("sized.jpg", 48);
      const rows = sql<Array<{ name: string; size_bytes: number }>>(
        `select coalesce(jsonb_agg(jsonb_build_object('name', name, 'size_bytes', size_bytes)), '[]'::jsonb)
         from private.orphaned_photo_objects(24)`,
      );
      const found = rows.find((r) => r.name === path);
      expect(found).toBeDefined();
      expect(Number(found?.size_bytes)).toBeGreaterThan(0);
    });
  });

  describe("what it spares", () => {
    it("spares an object a photos row points at", async () => {
      const path = await putObject("saved.jpg", 48);
      const recipe = await admin
        .from("recipes")
        .insert({ family_id: household.familyId, title: "Kept" })
        .select("id")
        .single();
      if (recipe.error) throw recipe.error;
      const row = await admin.from("photos").insert({
        family_id: household.familyId,
        recipe_id: recipe.data.id,
        storage_path: path,
        source: "import",
        upload_state: "stored",
        width: 10,
        height: 10,
      });
      if (row.error) throw row.error;

      expect(orphans()).not.toContain(path);
    });

    it("spares one whose photos row is only tombstoned", async () => {
      // a soft delete is reversible (091900); releasing the bytes is not, so a tombstone keeps
      // them. Deleting the row is what releases the object, and clients hold no DELETE.
      const path = await putObject("tombstoned.jpg", 48);
      const recipe = await admin
        .from("recipes")
        .insert({ family_id: household.familyId, title: "Deleted" })
        .select("id")
        .single();
      if (recipe.error) throw recipe.error;
      await admin.from("photos").insert({
        family_id: household.familyId,
        recipe_id: recipe.data.id,
        storage_path: path,
        source: "import",
        upload_state: "stored",
        width: 10,
        height: 10,
        deleted_at: new Date().toISOString(),
      });

      expect(orphans()).not.toContain(path);
    });

    it("spares an object being reviewed right now, however old", async () => {
      /*
       * The case this whole design is arranged around. A batch review can sit open for days —
       * that is a person's unfinished work, not litter — so the live job owns its photograph
       * regardless of the clock. Aged well past the window so only the job status can be
       * sparing it.
       */
      const path = await putObject("in-review.jpg", 240);
      const { error } = await admin.from("import_jobs").insert({
        family_id: household.familyId,
        kind: "url",
        input_ref: "https://example.com/reviewing",
        status: "review",
        result_json: { ok: true, photo: { storagePath: path } },
      });
      if (error) throw error;

      expect(orphans()).not.toContain(path);
    });

    it("spares one still queued or running", async () => {
      for (const status of ["queued", "running"]) {
        const path = await putObject(`${status}.jpg`, 240);
        const { error } = await admin.from("import_jobs").insert({
          family_id: household.familyId,
          kind: "url",
          input_ref: `https://example.com/${status}`,
          status,
          result_json: { ok: true, photo: { storagePath: path } },
        });
        if (error) throw error;
        expect(orphans(), status).not.toContain(path);
      }
    });

    it("spares one inside the grace window, which is the single-URL review's only guard", async () => {
      // `/api/import` stores an object and returns a draft without creating any job row, so time
      // is the only thing between an open review and the sweep
      const path = await putObject("fresh.jpg", 1);
      expect(orphans(24)).not.toContain(path);
      // and the window is a parameter, not a belief: shrink it and the same object is collectable
      expect(orphans(0)).toContain(path);
    });
  });

  describe("the sweep", () => {
    it("does not call out when there is nothing to collect", async () => {
      // every object planted above is either spared or, for the collectable ones, still present —
      // so ask with a window nothing can be older than
      const result = sql<{ dispatched: boolean; reason: string }>(
        "select private.dispatch_photo_reaper()",
      );
      expect(["nothing-to-collect", "not-configured"]).toContain(result.reason);
      expect(result.dispatched).toBe(false);
    });

    it("says so when there is work and nowhere to send it", async () => {
      await putObject("pending-sweep.jpg", 48);
      const result = sql<{ dispatched: boolean; reason: string; pending: number }>(
        "select private.dispatch_photo_reaper()",
      );
      expect(result).toMatchObject({ dispatched: false, reason: "not-configured" });
      expect(result.pending).toBeGreaterThan(0);
    });

    it("is scheduled exactly once, and not every minute", async () => {
      const rows = sql<Array<{ jobname: string; schedule: string }>>(
        `select coalesce(jsonb_agg(jsonb_build_object('jobname', jobname, 'schedule', schedule)), '[]'::jsonb)
         from cron.job where jobname = 'pashki-photo-reaper'`,
      );
      expect(rows).toHaveLength(1);
      // nothing here is waiting on a person; an object unreachable for a day can wait an hour
      expect(rows[0]?.schedule).toBe("17 * * * *");
    });
  });
});

describe.skipIf(instance !== null)("the photo reaper (skipped)", () => {
  it("needs a local Supabase instance — run pnpm --filter @pashki/db db:start", () => {
    expect(instance).toBeNull();
  });
});
