import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRINCIPAL_PROTEINS } from "@pashki/core";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * The column's CHECK and the code's list say the same thing.
 *
 * Nine places spelled these values out, and `turkey` was in none of them: "Ground Turkey Rice
 * Bowls" is stored as `pork` because a model forced to a closed list picks the **nearest available
 * value** rather than declining. The nine now read `PRINCIPAL_PROTEINS` from `@pashki/core`, and
 * SQL cannot import a TypeScript array — so this is the join, and it is asserted by writing each
 * value rather than by comparing the constraint's text, because a definition can be right about
 * words and wrong about behaviour.
 *
 * The drift it catches is silent in the direction that matters: a model answering a value the
 * column refuses raises a 400 the import path swallows, and the field lands null.
 */
const instance = readLocalInstance();
const CHECK_VIOLATION = "23514";

describe.skipIf(instance === null)("principal_protein", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin,
      url: instance.url,
      anonKey: instance.anonKey,
      label: "protein-enum",
    });
  });

  afterAll(async () => {
    if (instance && household) await deleteTestHousehold(admin, household);
  });

  it("accepts every protein the code offers", async () => {
    // not a loop over a hard-coded list: over the exported one, so adding a value here is the
    // same edit as adding it everywhere else
    expect(PRINCIPAL_PROTEINS).toContain("turkey");
    expect(PRINCIPAL_PROTEINS).toContain("duck");

    const rows = PRINCIPAL_PROTEINS.map((protein) => ({
      family_id: household.familyId,
      title: `probe ${protein}`,
      status: "active",
      visibility: "private",
      principal_protein: protein,
    }));

    // every column spelled on every row: a bulk insert passes NULL for whatever a row omits
    const { data, error } = await admin.from("recipes").insert(rows).select("principal_protein");
    expect(error).toBeNull();
    expect(data?.map((row) => row.principal_protein).sort()).toEqual([...PRINCIPAL_PROTEINS].sort());
  });

  it("still refuses a protein nobody declared", async () => {
    const { error } = await admin.from("recipes").insert({
      family_id: household.familyId,
      title: "probe unicorn",
      status: "active",
      visibility: "private",
      principal_protein: "unicorn",
    });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});
