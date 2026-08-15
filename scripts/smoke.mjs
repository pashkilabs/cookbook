#!/usr/bin/env node
/**
 * Does the deployed thing actually work?
 *
 * Written because it did not, and nothing noticed. Signup, email confirmation and provisioning
 * were verified end to end against production; **no import route was ever called**. Every route
 * that touched `sharp` had been returning 500 since the day it deployed, and the build was green,
 * the tests were green, and `check:parity` said the two environments agreed. A deployment is not
 * the sum of its migrations.
 *
 * So this exercises the *product*, not the front door: it signs up, confirms, provisions, writes
 * a recipe, imports one, queues a batch, plans a week, reads a shopping list, and puts a
 * photograph in storage — then deletes everything it made.
 *
 * **Any 500 is a failure, always.** A 500 is the deployment telling you a module did not load or
 * an exception escaped, and it is exactly the shape the sharp failure took. 401 and 403 are
 * answers; 500 is the absence of one.
 *
 *   node scripts/smoke.mjs                              # against $SMOKE_URL or production
 *   node scripts/smoke.mjs https://cookbook.pashki.com
 *   node scripts/smoke.mjs http://127.0.0.1:3000 --local
 *
 * Exit codes, the same three this repo uses everywhere:
 *   0  every check passed
 *   1  at least one failed — the deployment is broken
 *   2  could not measure — no credentials, or the host never answered
 *
 * Needs `apps/web/.env.local` (or the same variables in the environment) for the service role,
 * which is used only to create and destroy the fixtures a real user would create.
 */
import { readFileSync } from "node:fs";

const PASSED = 0;
const FAILED = 1;
const CANNOT_MEASURE = 2;

const argv = process.argv.slice(2);
const base = (argv.find((a) => a.startsWith("http")) ?? process.env.SMOKE_URL ?? "https://cookbook.pashki.com").replace(/\/$/, "");

function env() {
  const merged = { ...process.env };
  try {
    const text = readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const at = line.indexOf("=");
      if (at > 0 && !line.startsWith("#")) merged[line.slice(0, at)] ||= line.slice(at + 1);
    }
  } catch {
    // the environment alone is fine
  }
  return merged;
}

const E = env();
const SUPABASE = E.NEXT_PUBLIC_SUPABASE_URL;
const ANON = E.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = E.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE || !ANON || !SERVICE) {
  console.error("COULD NOT MEASURE: need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.");
  console.error("  Nothing was checked, which is not the same as nothing being wrong.");
  process.exit(CANNOT_MEASURE);
}

const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const results = [];
let session = null;

const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  return ok;
};

/**
 * The app authenticates by **cookie**, not by bearer token.
 *
 * `lib/supabase-server.ts` builds its client from `next/headers` cookies, so a request carrying
 * only an Authorization header is anonymous to every route — which looks exactly like a broken
 * route unless you know. `@supabase/ssr` stores the session as `sb-<ref>-auth-token`, base64 with
 * a marker prefix, split across numbered cookies when it is long.
 */
function sessionCookie(token) {
  const ref = new URL(SUPABASE).host.split(".")[0];
  const encoded = "base64-" + Buffer.from(JSON.stringify(token)).toString("base64");
  const LIMIT = 3180;
  if (encoded.length <= LIMIT) return `sb-${ref}-auth-token=${encoded}`;
  const parts = [];
  for (let i = 0; i * LIMIT < encoded.length; i += 1) {
    parts.push(`sb-${ref}-auth-token.${i}=${encoded.slice(i * LIMIT, (i + 1) * LIMIT)}`);
  }
  return parts.join("; ");
}

async function call(method, path, { body, auth = true, expect } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && session) {
    headers.Authorization = `Bearer ${session.access_token}`;
    headers.Cookie = sessionCookie(session);
  }
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    return { status: 0, body: String(error.message), threw: true };
  }
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 200);
  }
  return { status: response.status, body: parsed, expected: expect };
}

/**
 * The rule that would have caught the sharp failure.
 *
 * A route answering 401 is working — it considered the request and refused it. A route answering
 * 500 has not considered anything: the module did not load, or an exception escaped. Treating
 * "not 2xx" as acceptable is what let five broken routes look like protected ones.
 */
const alive = (result) => result.status !== 0 && result.status < 500;

async function rest(method, path, body) {
  const response = await fetch(`${SUPABASE}/rest/v1${path}`, {
    method,
    headers: { ...svc, Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** The exact select `packages/db`'s catalog reader issues. If they drift, this check is worthless. */
const INGREDIENT_COLUMNS =
  "id, key, canonical_name, aliases, aisle, dimension, grams_per_cup, can_size, grams_each, kcal_per_100g, energy_fdc_id";

const stamp = Date.now();
const address = `pashki-smoke+${stamp}@example.invalid`;
let accountId = null;
let familyId = null;
let invitedAccountId = null;
const madeRecipes = [];
const madeObjects = [];

console.log(`smoking ${base}\n`);

/**
 * Which build is answering, before anything else is asked.
 *
 * A whole session went on inferring deployment state from the shape of a 500. The commit makes
 * "the fix is not deployed yet" a fact rather than a hypothesis, and the configuration booleans
 * separate "not set" from "set wrongly" — the distinction the token PEM hid for days.
 */
try {
  const health = await call("GET", "/api/health", { auth: false });
  if (health.status === 200) {
    const c = health.body?.configured ?? {};
    console.log(`build ${String(health.body?.commit ?? "unknown").slice(0, 8)}  env ${health.body?.env}`);
    console.log(`  configured: ${Object.entries(c).map(([k, v]) => `${k}=${v ? "yes" : "NO"}`).join("  ")}\n`);
    record("health reports a build", Boolean(health.body?.commit) || health.body?.env === "local");
    for (const key of ["supabase", "siteUrl", "tokenSigner"]) {
      record(`configured: ${key}`, c[key] === true, c[key] === true ? "" : "missing on this deployment");
    }
  } else {
    console.log(`(no /api/health on this build — HTTP ${health.status})\n`);
  }
} catch {
  // an old build without the route; the sweep below still runs
}

try {
  // ---------------------------------------------------------------------------
  // 1. Reachability. Every route class, before any of them is asked to do work.
  //
  // Unauthenticated on purpose: a 401 proves the module loaded and the handler ran, which is the
  // property that was missing. This is the sweep that would have caught the sharp failure on the
  // day it shipped.
  // ---------------------------------------------------------------------------
  console.log("routes answer at all (401 is an answer; 500 is not)");
  const surface = [
    ["GET", "/api/import/jobs"],
    ["POST", "/api/import", { url: "https://example.com/x" }],
    ["POST", "/api/import/batch", { urls: "https://example.com/x" }],
    ["POST", "/api/import/drain", {}],
    ["POST", "/api/import/jobs/00000000-0000-0000-0000-000000000000", {}],
    ["POST", "/api/recipes", {}],
    ["PATCH", "/api/recipes/00000000-0000-0000-0000-000000000000", {}],
    ["POST", "/api/plan-entries", {}],
    ["POST", "/api/shortlist", {}],
    ["POST", "/api/shopping-ticks", {}],
    ["POST", "/api/pantry", {}],
    ["POST", "/api/household", {}],
    ["POST", "/api/members", {}],
    ["GET", "/api/invitations"],
    ["POST", "/api/invitations", {}],
    ["POST", "/api/invitations/accept", {}],
    ["POST", "/api/signup", {}],
    ["POST", "/api/resend", {}],
    ["GET", "/api/platform/session"],
  ];
  for (const [method, path, body] of surface) {
    const result = await call(method, path, { body, auth: false });
    record(`${method} ${path}`, alive(result), result.status === 0 ? result.body : `HTTP ${result.status}`);
  }

  console.log("\npages render");
  for (const path of ["/", "/sign-in", "/recipes", "/planner", "/shopping", "/recipes/import", "/household"]) {
    const result = await call("GET", path, { auth: false });
    record(`GET ${path}`, alive(result), `HTTP ${result.status}`);
  }

  // ---------------------------------------------------------------------------
  // 2. A real household, made the way a person makes one.
  // ---------------------------------------------------------------------------
  console.log("\nauth and provisioning");
  const signup = await call("POST", "/api/signup", {
    auth: false,
    body: { email: address, password: `Smoke-${stamp}-Aa1!`, householdName: "Smoke Test", displayName: "Smoke" },
  });
  record("signup accepted", signup.status === 202, `HTTP ${signup.status}`);

  // confirm without waiting for mail: this checks the app, not the inbox, and the mail path has
  // its own end-to-end verification in docs/deployment.md
  const users = await (await fetch(`${SUPABASE}/auth/v1/admin/users?per_page=200`, { headers: svc })).json();
  const user = (users.users ?? []).find((u) => (u.email ?? "").toLowerCase() === address);
  accountId = user?.id ?? null;
  if (accountId) {
    await fetch(`${SUPABASE}/auth/v1/admin/users/${accountId}`, {
      method: "PUT",
      headers: svc,
      body: JSON.stringify({ email_confirm: true }),
    });
  }
  record("account exists and is confirmable", Boolean(accountId));

  const token = await (await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: address, password: `Smoke-${stamp}-Aa1!` }),
  })).json();
  session = token.access_token ? token : null;
  record("can sign in once confirmed", Boolean(session));

  const provisioned = await call("POST", "/api/household", { body: {} });
  familyId = provisioned.body?.familyId ?? null;
  record("provisioning creates a household", provisioned.status === 200 && Boolean(familyId), `HTTP ${provisioned.status}`);

  if (!familyId) throw new Error("no household; the rest cannot be measured");

  // an operator grant, so the write paths below are testing themselves rather than the meter
  await rest("POST", "/entitlements?on_conflict=family_id,app_key", {
    family_id: familyId,
    app_key: "recipes",
    tier: "full",
    quota_json: { imports: { limit: 50, used: 0, resetsAt: null, periodDays: 30 } },
    valid_until: new Date(Date.now() + 86400000).toISOString(),
    grace_until: new Date(Date.now() + 2 * 86400000).toISOString(),
  });

  // ---------------------------------------------------------------------------
  // 3. The product.
  // ---------------------------------------------------------------------------
  console.log("\nrecipes");
  const created = await call("POST", "/api/recipes", {
    body: {
      title: "Smoke Test Pie",
      servings: "4",
      timeMinutes: "30",
      sourceName: "",
      sourceUrl: "",
      ingredients: "2 cups flour\n1 pint double cream\n3 lemons",
      steps: "Mix.\nBake.",
    },
  });
  const recipeId = created.body?.id ?? null;
  if (recipeId) madeRecipes.push(recipeId);
  record("create a recipe with ingredients and steps", created.status === 200 && Boolean(recipeId), `HTTP ${created.status}`);

  if (recipeId) {
    const children = await rest("GET", `/recipe_ingredients?recipe_id=eq.${recipeId}&select=item_text`);
    record("its ingredients were parsed and stored", (children ?? []).length === 3, `${(children ?? []).length} rows`);

    const edited = await call("PATCH", `/api/recipes/${recipeId}`, {
      body: { title: "Smoke Test Pie II", servings: "6", timeMinutes: "35", sourceName: "", sourceUrl: "", ingredients: "2 cups flour", steps: "Mix." },
    });
    record("edit a recipe", edited.status === 200, `HTTP ${edited.status}`);
  }

  console.log("\nimport — the part that was broken and nothing noticed");
  const single = await call("POST", "/api/import", { body: { url: "https://www.recipetineats.com/chicken-tikka-masala/" } });
  // 200 is a read recipe; 422 is an honest failure from a site refusing us. Both mean the route
  // ran. 500 means it did not, which is the whole point of this file.
  record("single-URL import runs", [200, 422].includes(single.status), `HTTP ${single.status}`);
  record(
    "single-URL import returns a draft",
    single.status !== 200 || Boolean(single.body?.draft?.title),
    single.status === 200 ? `“${single.body?.draft?.title ?? "?"}”` : "site refused; route still ran",
  );
  if (single.status === 200 && single.body?.photo?.storagePath) madeObjects.push(single.body.photo.storagePath);
  /*
   * The check that names the cause instead of shrugging at it. `photoFailure` carries the reason
   * out of the deployed function, so `resizer-unavailable` and its message are visible here rather
   * than only in a log nobody is reading.
   */
  const photoFailure = single.body?.photoFailure ?? null;
  record(
    "a photograph came back with it",
    single.status !== 200 || Boolean(single.body?.photo) || !photoFailure,
    photoFailure ? `${photoFailure.kind}: ${String(photoFailure.detail).slice(0, 160)}` : single.body?.photo ? "stored" : "the page had none",
  );

  const batch = await call("POST", "/api/import/batch", {
    body: { urls: "https://www.bbcgoodfood.com/recipes/classic-lasagne\nhttps://www.instagram.com/p/x/\nhttps://www.bbcgoodfood.com/recipes/classic-lasagne" },
  });
  record("batch import queues", batch.status === 200, `HTTP ${batch.status}`);
  record(
    "batch rejects a social link and collapses a duplicate at submission",
    batch.status === 200 && batch.body?.queued === 1 && batch.body?.rejected === 1 && batch.body?.duplicates === 1,
    batch.status === 200 ? `queued ${batch.body?.queued}, rejected ${batch.body?.rejected}, duplicate ${batch.body?.duplicates}` : "",
  );

  const drained = await call("POST", "/api/import/drain", { body: { maxJobs: 2 } });
  record("the drain route runs", drained.status === 200, `HTTP ${drained.status}`);

  const progress = await call("GET", "/api/import/jobs");
  record("job progress is readable", progress.status === 200, `HTTP ${progress.status}`);

  /*
   * The scheduler's door, which is not the one the batch screen uses.
   *
   * The route accepted a session and refused the shared secret, so smoke passed while the queue
   * never drained: the secret was set on both sides and *differed*. Testing the session path only
   * is how a check can be green about a feature nobody can use.
   */
  if (E.PASHKI_DRAIN_SECRET) {
    const asScheduler = await fetch(`${base}/api/import/drain`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pashki-drain-secret": E.PASHKI_DRAIN_SECRET },
      body: JSON.stringify({ maxJobs: 1 }),
      signal: AbortSignal.timeout(90_000),
    });
    record(
      "the drain route accepts the scheduler's secret",
      asScheduler.status === 200,
      asScheduler.status === 401
        ? "401 — the secret on the host differs from the one the scheduler presents"
        : `HTTP ${asScheduler.status}`,
    );
  } else {
    console.log("  --    scheduler secret not in the environment; that path was not checked");
  }

  console.log("\nhousehold members");
  const added = await call("POST", "/api/members", { body: { displayName: "Smoke Child" } });
  const memberId = added.body?.member?.id ?? null;
  record("add a child", added.status === 200 && Boolean(memberId), `HTTP ${added.status}`);
  record(
    "the child has a colour and no account",
    added.body?.member?.accountId === null && Boolean(added.body?.member?.colour),
    added.body?.member?.colour ? `colour ${added.body.member.colour}` : "no colour",
  );

  if (memberId) {
    const renamed = await call("PATCH", "/api/members", {
      body: { id: memberId, displayName: "Smoke Child II", colour: "plum" },
    });
    record(
      "rename and recolour",
      renamed.status === 200 && renamed.body?.member?.colour === "plum",
      `HTTP ${renamed.status}`,
    );

    const badColour = await call("PATCH", "/api/members", {
      body: { id: memberId, colour: "#ff00ff" },
    });
    record("a colour outside the palette is refused", badColour.status === 400, `HTTP ${badColour.status}`);

    // the rule that stops a household deleting its only adult and stranding itself
    const members = await rest("GET", `/family_members?family_id=eq.${familyId}&account_id=eq.${accountId}&select=id`);
    const mine = members?.[0]?.id;
    if (mine) {
      const self = await call("DELETE", "/api/members", { body: { id: mine } });
      record("refuses to remove yourself", self.status === 400, `HTTP ${self.status}`);
    }

    const removed = await call("DELETE", "/api/members", { body: { id: memberId } });
    record("remove a child", removed.status === 200, `HTTP ${removed.status}`);
  }

  console.log("\ninvitations");
  const invitee = `pashki-smoke-invited+${stamp}@example.invalid`;
  const invited = await call("POST", "/api/invitations", { body: { email: invitee } });
  // 200 sent, 202 recorded-but-not-sent (no RESEND_API_KEY on this deployment). Both mean the
  // invitation exists, which is what the rest of this section needs.
  record("invite an adult", [200, 202].includes(invited.status), `HTTP ${invited.status}`);
  record(
    "the invitation is recorded and carries no token",
    Boolean(invited.body?.invitation?.id) && invited.body?.invitation?.token === undefined,
    invited.body?.sent === false ? "recorded; email not sent on this deployment" : "sent",
  );

  const pending = await call("GET", "/api/invitations");
  record(
    "it shows as pending",
    pending.status === 200 && (pending.body?.invitations ?? []).some((i) => i.email === invitee),
    `HTTP ${pending.status}`,
  );

  /*
   * Accepting, end to end. The token never leaves the database in an API response — by design —
   * so the smoke test reads the hash's row directly and mints the claim the way the email would.
   * That is the one place this test reaches past the product, and it is reaching for something a
   * real invitee gets by email.
   */
  const invitedAddress = invitee;
  const invitedPassword = `Smoke-${stamp}-Bb2!`;
  const inviteeAccount = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: svc,
    body: JSON.stringify({ email: invitedAddress, password: invitedPassword, email_confirm: true }),
  }).then((r) => r.json());
  invitedAccountId = inviteeAccount?.id ?? null;

  const claim = await rest(
    "POST",
    "/rpc/accept_invitation_by_id",
    {
      p_invitation_id: invited.body?.invitation?.id,
      p_account_id: invitedAccountId,
      p_email: invitedAddress,
      p_display_name: "Smoke Invitee",
    },
  );
  record("accepting joins the inviting household", claim?.status === "joined", claim?.status ?? "no answer");
  record(
    "and joins THAT household, not another",
    claim?.familyId === familyId,
    claim?.familyId === familyId ? "" : `joined ${claim?.familyId}`,
  );

  const reused = await rest("POST", "/rpc/accept_invitation_by_id", {
    p_invitation_id: invited.body?.invitation?.id,
    p_account_id: invitedAccountId,
    p_email: invitedAddress,
    p_display_name: "Smoke Invitee",
  });
  record("a token works once and only once", reused?.status === "used", reused?.status ?? "no answer");

  console.log("\nplanner, shopping, storage");
  if (recipeId) {
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const weekStart = monday.toISOString().slice(0, 10);

    const planned = await call("POST", "/api/plan-entries", {
      body: { recipeId, date: weekStart, weekStart, servings: 9 },
    });
    record("assign a recipe to a day, for nine", planned.status === 200, `HTTP ${planned.status}`);

    /*
     * The recipe serves 6 by the time the planner runs (it was edited above), so nine people is
     * 1.5× — and that multiplier is what reaches
     * `packages/core`. Read back from the database because the whole point of the change is that
     * the shopping list buys for six.
     */
    const entries = await rest("GET", `/plan_entries?family_id=eq.${familyId}&select=id,scale&deleted_at=is.null`);
    const entryId = entries?.[0]?.id;
    record(
      "servings become the stored multiplier",
      Number(entries?.[0]?.scale) === 1.5,
      `scale ${entries?.[0]?.scale}`,
    );

    const absurd = await call("POST", "/api/plan-entries", {
      body: { recipeId, date: weekStart, weekStart, servings: 0 },
    });
    record("refuses nobody-servings", absurd.status === 400, `HTTP ${absurd.status}`);

    const nonsense = await call("POST", "/api/plan-entries", {
      body: { recipeId, date: weekStart, weekStart, servings: "six" },
    });
    record("refuses a servings figure that is not a number", nonsense.status === 400, `HTTP ${nonsense.status}`);

    // the same recipe on the same day: told, not merged and not refused
    const again = await call("POST", "/api/plan-entries", {
      body: { recipeId, date: weekStart, weekStart, servings: 4 },
    });
    record(
      "adding it twice offers to feed more instead",
      again.status === 409 && again.body?.error === "already-planned" && Boolean(again.body?.existing?.id),
      `HTTP ${again.status}`,
    );
    record(
      "and says what is already there",
      again.body?.existing?.servings === 9,
      `existing serves ${again.body?.existing?.servings}`,
    );

    if (entryId) {
      const more = await call("PATCH", `/api/plan-entries/${entryId}`, { body: { servings: 10 } });
      record("raising the servings works", more.status === 200 && more.body?.servings === 10, `HTTP ${more.status}`);
    }

    const shortlisted = await call("POST", "/api/shortlist", { body: { recipeId, weekStart } });
    record("shortlist a recipe", shortlisted.status === 200, `HTTP ${shortlisted.status}`);

    const ticked = await call("POST", "/api/shopping-ticks", { body: { weekStart, itemKey: "double-cream", ticked: true } });
    record("tick a shopping line", ticked.status === 200, `HTTP ${ticked.status}`);

    /*
     * The check that would have caught the dead shopping list.
     *
     * It used to assert HTTP 200 and nothing else — and the page degrades to 200 with an error
     * message in it, so a missing column sailed through CI twice while the list was gone for a
     * real household. **A status code is not a rendered page.** This asserts the planned recipe's
     * ingredients actually appear, and that the failure banner does not.
     */
    const shopping = await call("GET", `/shopping?week=${weekStart}`);
    const html = typeof shopping.body === "string" ? shopping.body : JSON.stringify(shopping.body);
    record("the shopping list renders", alive(shopping), `HTTP ${shopping.status}`);
    record(
      "and does not report a failure",
      !html.includes("Could not build the list"),
      html.includes("Could not build the list") ? "the page says it could not build the list" : "",
    );
    record(
      "and actually lists the planned ingredients",
      html.includes("flour"),
      html.includes("flour") ? "" : "the planned recipe's ingredients are not on the page",
    );

    /*
     * The class behind that bug: code selecting a column its database lacks. Asserted directly
     * against the app's own select string, so a schema/code split fails here rather than in a
     * household's kitchen — and with no credentials this test did not already hold.
     */
    const contract = await fetch(
      `${SUPABASE}/rest/v1/ingredients?select=${encodeURIComponent(INGREDIENT_COLUMNS)}&limit=1`,
      { headers: svc },
    );
    record(
      "the database has every column the app selects",
      contract.ok,
      contract.ok ? "" : `PostgREST refused the app's select: ${await contract.text().then((t) => t.slice(0, 120))}`,
    );
  }

  const path = `${familyId}/smoke-${stamp}.jpg`;
  const upload = await fetch(`${SUPABASE}/storage/v1/object/recipe-photos/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, ...new Array(64).fill(0)]),
  });
  if (upload.ok) madeObjects.push(path);
  record("storage accepts an object", upload.ok, `HTTP ${upload.status}`);

  const anonRead = await fetch(`${SUPABASE}/storage/v1/object/recipe-photos/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  record("and refuses it to anon (decisions §17)", !anonRead.ok, `HTTP ${anonRead.status}`);
} catch (error) {
  record("the run completed", false, String(error.message).slice(0, 160));
} finally {
  // ---------------------------------------------------------------------------
  // Leave nothing behind. A smoke test that litters production stops being run.
  // ---------------------------------------------------------------------------
  try {
    if (madeObjects.length) {
      await fetch(`${SUPABASE}/storage/v1/object/recipe-photos`, {
        method: "DELETE",
        headers: svc,
        body: JSON.stringify({ prefixes: madeObjects }),
      });
    }
    if (familyId) {
      /*
       * A drained job stores its photograph through the runner, so the path is in `result_json`
       * and nowhere this script ever saw it. Deleting the rows without the objects left one
       * unreachable file per run — found by the reaper's own census, which is a fair result for
       * a test that exists to stop exactly this kind of silence.
       */
      const jobs = (await rest("GET", `/import_jobs?family_id=eq.${familyId}&select=result_json`)) ?? [];
      const jobObjects = jobs
        .map((job) => job.result_json?.photo?.storagePath)
        .filter((path) => typeof path === "string");
      if (jobObjects.length) {
        await fetch(`${SUPABASE}/storage/v1/object/recipe-photos`, {
          method: "DELETE",
          headers: svc,
          body: JSON.stringify({ prefixes: jobObjects }),
        });
      }
      await rest("PATCH", `/import_jobs?family_id=eq.${familyId}`, { status: "cancelled" });
      await rest("DELETE", `/import_jobs?family_id=eq.${familyId}`);
      for (const table of ["shopping_ticks", "shortlist_entries", "plan_entries", "photos", "recipe_ingredients", "recipe_steps", "ratings"]) {
        await rest("DELETE", `/${table}?family_id=eq.${familyId}`);
      }
      await rest("DELETE", `/meal_plans?family_id=eq.${familyId}`);
      await rest("DELETE", `/recipes?family_id=eq.${familyId}`);
      await rest("DELETE", `/entitlements?family_id=eq.${familyId}`);
      await rest("DELETE", `/family_members?family_id=eq.${familyId}`);
      await rest("DELETE", `/families?id=eq.${familyId}`);
    }
    if (familyId) await rest("DELETE", `/invitations?family_id=eq.${familyId}`);
    for (const id of [accountId, invitedAccountId].filter(Boolean)) {
      await fetch(`${SUPABASE}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: svc });
    }
    /*
     * Verified, not announced. "cleaned up" was printed for three runs that each left an object
     * behind, which is the same failure mode this whole file exists to catch: a message is not a
     * measurement.
     */
    if (familyId) {
      const left = await fetch(`${SUPABASE}/storage/v1/object/list/recipe-photos`, {
        method: "POST",
        headers: svc,
        body: JSON.stringify({ prefix: familyId, limit: 100 }),
      }).then((r) => r.json()).catch(() => []);
      const stranded = Array.isArray(left) ? left.length : 0;
      console.log(
        stranded === 0
          ? "\ncleaned up: household, recipes, jobs, objects, account"
          : `\nCLEANUP INCOMPLETE: ${stranded} object(s) left under ${familyId} — the reaper will collect them`,
      );
    }
  } catch (error) {
    console.error(`\nWARNING: cleanup incomplete — ${String(error.message).slice(0, 120)}`);
  }
}

/*
 * A host that never answered has not told us the deployment is broken — it has told us nothing.
 * Reporting that as a failure is how a check starts crying wolf and stops being run, which is the
 * same three-outcome rule the rest of this repo follows.
 */
const reached = results.filter((r) => r.detail !== "fetch failed" && !String(r.detail ?? "").includes("ENOTFOUND"));
if (reached.length === 0) {
  console.log("-".repeat(72));
  console.log(`COULD NOT MEASURE: ${base} never answered. Nothing was checked.`);
  process.exit(CANNOT_MEASURE);
}

const failed = results.filter((r) => !r.ok);
console.log("-".repeat(72));
if (failed.length === 0) {
  console.log(`SMOKE: ${results.length} checks passed against ${base}`);
  process.exit(PASSED);
}
console.log(`SMOKE: ${failed.length} of ${results.length} FAILED against ${base}`);
for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ""}`);
process.exit(FAILED);
