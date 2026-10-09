import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALLERGENS } from "@pashki/core";
import {
  createTestHousehold, deleteTestHousehold, readLocalInstance, type TestHousehold,
} from "./support/index.js";

/**
 * What this household avoids — a household setting, not health data (§71).
 *
 * **The first test is the one that matters.** The nine allergen names exist twice: as the
 * `Allergen` union in `packages/core`, which does the matching, and in
 * `private.known_allergens()`, which validates storage. SQL cannot import TypeScript, so this
 * compares them — a value added on one side and not the other would otherwise mean a household
 * could set an allergen nothing matches, or be refused one it is entitled to. Both fail silently;
 * the first is a filter that quietly stops filtering.
 */
const instance = readLocalInstance();

describe.skipIf(instance === null)("the household's avoided allergens", () => {
  let admin: SupabaseClient;
  let household: TestHousehold;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    household = await createTestHousehold({
      admin, url: instance.url, anonKey: instance.anonKey, label: "allergens", entitled: true,
    });
  }, 60_000);

  afterAll(async () => {
    if (instance && household) await deleteTestHousehold(admin, household);
  });

  /*
   * The two-sites test, and it works by *attempting* rather than by reading a list.
   *
   * Comparing `private.known_allergens()` to `ALLERGENS` would need the private schema exposed
   * over the API. Storing every value core can match is the better test anyway: it exercises the
   * constraint rather than inspecting it, so it fails for the right reason if either side moves.
   */
  it("stores every allergen core can match", async () => {
    const stored = await admin
      .from("families")
      .update({ avoided_allergens: [...ALLERGENS] })
      .eq("id", household.familyId)
      .select("avoided_allergens")
      .single();
    expect(stored.error, "an allergen core can match must be storable").toBeNull();
    expect(new Set(stored.data?.avoided_allergens)).toEqual(new Set(ALLERGENS));
  });

  it("refuses an allergen that is not one of the nine", async () => {
    // attempted against a real household: a probe that cannot succeed has measured nothing, and
    // the migration's own DO block could not insert one (families needs an owner account)
    const bad = await admin
      .from("families")
      .update({ avoided_allergens: ["peanut", "unobtainium"] })
      .eq("id", household.familyId)
      .select("avoided_allergens");
    expect(bad.error).not.toBeNull();
  });

  it("stores an empty set, which is what every household had before the column", async () => {
    const cleared = await admin
      .from("families")
      .update({ avoided_allergens: [] })
      .eq("id", household.familyId)
      .select("avoided_allergens")
      .single();
    expect(cleared.error).toBeNull();
    expect(cleared.data?.avoided_allergens).toEqual([]);
  });

  it("is not writable by the household's own client — it is a platform setting", async () => {
    const attempt = await household.client
      .from("families")
      .update({ avoided_allergens: ["peanut"] })
      .eq("id", household.familyId)
      .select("avoided_allergens");
    expect(attempt.error ?? attempt.data?.length === 0).toBeTruthy();
  });

  /*
   * No test here for the absence of a per-member allergen column. The migration asserts it at
   * apply time via `assert_allergens_are_household_wide`, and the first version of this file
   * "tested" it with `expect(error === null || typeof error === "object").toBe(true)` — which is
   * true of every possible value. A test that cannot fail is the counted-but-never-executed trap
   * wearing a green tick, so it is gone rather than weakened.
   */
});
