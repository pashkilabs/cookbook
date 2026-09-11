import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHousehold,
  deleteTestHousehold,
  readLocalInstance,
  type TestHousehold,
} from "./support/index.js";

/**
 * A blend may never be published, and this is the test that attempts it.
 *
 * §17 publishes a household's own recipes to the world. A blend is a derivative of two
 * bloggers' prose, which is a different thing from a household's own photograph of its own
 * dinner, and the copyright posture is unsettled (§open 3). Private is the footing the
 * imported prose already sits on: nothing new leaves the household.
 *
 * Recorded as a boundary rather than a default — **if published recipes are ever widened,
 * this must stay narrow.** A migration's self-check only knows what its own version knew, so
 * the way to verify a rule is to attempt the thing it forbids rather than to read
 * `schema_migrations` or trust `check:parity`.
 *
 * Every test here carries a control. The first version of this probe reported REFUSED for
 * everything because the seed had no households, so every insert touched zero rows and the
 * control passed vacuously — a probe that cannot succeed has measured nothing.
 */
const instance = readLocalInstance();
const CHECK_VIOLATION = "23514";

describe.skipIf(instance === null)("a blend is never publishable", () => {
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
      label: "blend",
    });
  });

  afterAll(async () => {
    if (!instance) return;
    await deleteTestHousehold(admin, household);
  });

  const recipe = (extra: Record<string, unknown>) => ({
    family_id: household.familyId,
    title: "Probe",
    status: "active",
    times_made: 0,
    ...extra,
  });

  it("publishes an ordinary recipe, so the refusals below mean something", async () => {
    // the control. Without it, "refused" is indistinguishable from "never attempted"
    const { data, error } = await admin
      .from("recipes")
      .insert(recipe({ visibility: "public" }))
      .select("id, visibility")
      .single();
    expect(error).toBeNull();
    expect(data?.visibility).toBe("public");
  });

  it("refuses to create a blend that is public", async () => {
    const { error } = await admin
      .from("recipes")
      .insert(recipe({ visibility: "public", derived_at: new Date().toISOString() }));
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain("recipes_blends_are_never_public");
  });

  it("allows a private blend, which is the whole point of the feature", async () => {
    const { error } = await admin
      .from("recipes")
      .insert(recipe({ visibility: "private", derived_at: new Date().toISOString() }));
    expect(error).toBeNull();
  });

  it("refuses to publish a blend that already exists", async () => {
    const made = await admin
      .from("recipes")
      .insert(recipe({ visibility: "private", derived_at: new Date().toISOString() }))
      .select("id")
      .single();
    expect(made.error).toBeNull();

    const { error } = await admin
      .from("recipes")
      .update({ visibility: "public" })
      .eq("id", made.data!.id);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("refuses to turn an already-published recipe into a blend", async () => {
    // the other direction, which a one-sided check would miss
    const made = await admin
      .from("recipes")
      .insert(recipe({ visibility: "public" }))
      .select("id")
      .single();
    expect(made.error).toBeNull();

    const { error } = await admin
      .from("recipes")
      .update({ derived_at: new Date().toISOString() })
      .eq("id", made.data!.id);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("does not let a household mark its own recipe a blend", async () => {
    // §26: the column grant, not the policy. A client that could stamp derived_at could
    // unmark a blend and then publish it, going round the CHECK rather than through it.
    const made = await admin
      .from("recipes")
      .insert(recipe({ visibility: "private" }))
      .select("id")
      .single();
    expect(made.error).toBeNull();

    const { error } = await household.client
      .from("recipes")
      .update({ derived_at: new Date().toISOString() })
      .eq("id", made.data!.id);
    expect(error).not.toBeNull();
  });
});

/**
 * The cross-household read surface is revoked pending the feature (20260911090000).
 *
 * Attempted rather than assumed: a second household publishes a recipe, and the first tries to
 * read it. Both halves matter — the read must fail, and the publisher must still see its own,
 * or the revocation took more than it meant to.
 */
describe.skipIf(instance === null)("a published recipe is not readable across households", () => {
  let admin: SupabaseClient;
  let mine: TestHousehold;
  let theirs: TestHousehold;
  let theirPublicRecipe: string;

  beforeAll(async () => {
    if (!instance) return;
    admin = createClient(instance.url, instance.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    mine = await createTestHousehold({ admin, url: instance.url, anonKey: instance.anonKey, label: "reader" });
    theirs = await createTestHousehold({ admin, url: instance.url, anonKey: instance.anonKey, label: "publisher" });

    const made = await admin
      .from("recipes")
      .insert({ family_id: theirs.familyId, title: "Their public roast", status: "active",
        times_made: 0, visibility: "public" })
      .select("id")
      .single();
    if (made.error) throw made.error;
    theirPublicRecipe = made.data.id;
  });

  afterAll(async () => {
    if (!instance) return;
    await deleteTestHousehold(admin, mine);
    await deleteTestHousehold(admin, theirs);
  });

  it("lets the household that published it read its own, so the check below means something", async () => {
    const { data } = await theirs.client
      .from("recipes").select("id, title").eq("id", theirPublicRecipe).maybeSingle();
    expect(data?.title).toBe("Their public roast");
  });

  it("does not let another household read it, even though it is marked public", async () => {
    // RLS returns no rows rather than an error: a revoked read and a missing row look the same
    // to a client, which is the safe direction
    const { data } = await mine.client
      .from("recipes").select("id").eq("id", theirPublicRecipe).maybeSingle();
    expect(data).toBeNull();
  });

  it("does not leak its ingredients either, which is a separate policy", async () => {
    await admin.from("recipe_ingredients").insert({
      family_id: theirs.familyId, recipe_id: theirPublicRecipe, position: 0,
      item_text: "a whole chicken", amount: 1, unit: null, note: "", is_estimated: false,
      section: null, ingredient_id: null,
    });
    const { data } = await mine.client
      .from("recipe_ingredients").select("item_text").eq("recipe_id", theirPublicRecipe);
    expect(data ?? []).toHaveLength(0);
  });
});
