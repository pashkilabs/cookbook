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
import { createHash } from "node:crypto";
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

/**
 * A check that could not run.
 *
 * Recorded rather than merely printed. The skip line was already on screen, but it never reached
 * the verdict — so the run announced "71 checks passed" where the last one said 72, and the only
 * thing distinguishing a complete run from an incomplete one was remembering the old number.
 * Silence reads as success; so does a smaller number nobody is counting.
 */
const skipped = [];
/*
 * The adult's own member id, set when the roster is exercised and used much later by the
 * preference checks. It has to be the adult: the child added in that section is REMOVED at the
 * end of it, so a later block using the child gets a correct 404 from a correct route.
 */
let adultMemberId = null;
const skip = (name, why) => {
  skipped.push({ name, why });
  console.log(`  --    ${name}  — NOT CHECKED: ${why}`);
};

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
    /*
     * The whole body, not a slice.
     *
     * This truncated to 200 characters, which is `<!DOCTYPE html><head>` and nothing else — so the
     * content assertions below were matching against a page prefix and failing on a page that was
     * perfectly correct. A check that cannot see what it is checking is worse than no check: it
     * cost a round of investigating the product for a bug in the test.
     */
    parsed = text;
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

/**
 * The page as a reader sees it, which is not the page as React writes it.
 *
 * React's SSR separates a static string from an interpolated one with an empty HTML comment, so
 * `Step {n} of {total}` arrives as `Step <!-- -->1<!-- --> of <!-- -->2` and a needle spelled the
 * way the screen reads it finds nothing. The check fails, the screen is correct, and the failure
 * is indistinguishable from the count being absent — which is how this was first read.
 *
 * Same family as grepping minified CSS with the unminified spelling: **a value you had to spell
 * correctly to find is a value you can fail to find while it is right there**, and absence looks
 * identical whether or not you were looking in the right place. So every human-text assertion
 * goes through this rather than through the raw body, because the next interpolated marker will
 * make the same mistake and nothing else would catch it.
 *
 * Entities as well, for the same reason: React writes `’` and a needle typed with an apostrophe
 * misses it.
 */
/**
 * A detail that cannot contradict its own verdict.
 *
 * `record` prints its detail whichever way the check went, so a detail *computed* as though the
 * check failed reads `ok … no "Wed · " chip` — which is exactly as confusing as the inverse this
 * script was already corrected for, where a failing marker read `FAIL … found`.
 *
 * I have now written that backwards three times in one body of work: once in the marker loop,
 * once in the plan-it walk, once here. Three is not a discipline problem, it is a missing helper
 * — the same conclusion as a rule that has failed five times needing a guard rather than a
 * reminder. Pass the text and the needle and the wording follows from the answer.
 */
const foundDetail = (text, needle, missing) =>
  String(text ?? "").includes(needle) ? `"${needle}"` : (missing ?? `no "${needle}"`);

const visible = (html) =>
  String(html ?? "")
    .replace(/<!--.*?-->/g, "")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\u2019/g, "'");

/**
 * A service-role read or write, used to check what the product actually stored.
 *
 * **Throws on a refusal rather than returning it as data.** PostgREST answers a 4xx with valid
 * JSON — `{"code":"42501","message":"..."}` — so returning the parsed body regardless meant a
 * refused query became an *error object* that callers indexed into. `entries?.[0]?.id` came back
 * undefined and the assertion above it failed reporting the wrong thing entirely: not "the
 * database refused us" but "servings did not become the stored multiplier".
 *
 * That is the same class as `call()` truncating a page to 200 characters, and the same class as a
 * mutation harness reading zero matched tests as a pass: **a check that can fail for a reason
 * unrelated to what it checks.** Each one costs a session chasing a product bug that is not there.
 * A broken measurement must announce itself as broken.
 */
async function rest(method, path, body, prefer) {
  const response = await fetch(`${SUPABASE}/rest/v1${path}`, {
    method,
    headers: {
      ...svc,
      // `on_conflict=` in the URL does nothing without this: PostgREST treats the request as a
      // plain insert and answers 409. Dormant against production, where provisioning issues no
      // entitlement, and immediate against a dev deployment that does.
      Prefer: ["return=representation", prefer].filter(Boolean).join(","),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const failure = new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 160)}`);
    // the service role being refused is a broken *measurement*, not a broken deployment — three
    // outcomes, as everywhere else in this repo
    failure.measurement = true;
    throw failure;
  }
  return text ? JSON.parse(text) : null;
}

/**
 * A GoTrue admin call, held to the same rule as `rest`.
 *
 * These *set up* a measurement — list the account signup just made, mint an invitee to accept with
 * — rather than testing the product. So a refusal here is a broken measurement, and returning the
 * error body as data would surface it as `accountId = null` and report "account exists and is
 * confirmable — FAIL", which names the wrong thing entirely.
 *
 * Sign-in is deliberately *not* routed through this: whether a confirmed account can sign in is
 * the product under test, so a 400 there is a real failure and must stay an assertion.
 */
async function admin(method, path, body) {
  const response = await fetch(`${SUPABASE}/auth/v1/admin${path}`, {
    method,
    headers: svc,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const failure = new Error(`${method} /auth/v1/admin${path} -> ${response.status} ${text.slice(0, 160)}`);
    failure.measurement = true;
    throw failure;
  }
  return text ? JSON.parse(text) : null;
}

/** An upsert, which PostgREST only performs when asked in a header. */
const restUpsert = (method, path, body) => rest(method, path, body, "resolution=merge-duplicates");

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
    /*
     * Strings print as their value, not as yes/NO.
     *
     * regression: this line mapped every field through `v ? "yes" : "NO"`, so the three fields
     * that report a *reason* rather than a fact were flattened to `yes` — including
     * `schema="MISSING 20261008090000 — run: pnpm --filter @pashki/db db:push"`, which printed
     * `schema=yes`. The route named the fault and the summary line hid it. A truthy string is not
     * a pass.
     */
    console.log(
      `  configured: ${Object.entries(c)
        .map(([k, v]) => `${k}=${typeof v === "boolean" ? (v ? "yes" : "NO") : v === null ? "unset" : v}`)
        .join("  ")}\n`,
    );
    record("health reports a build", Boolean(health.body?.commit) || health.body?.env === "local");
    for (const key of ["supabase", "siteUrl", "tokenSigner"]) {
      record(`configured: ${key}`, c[key] === true, c[key] === true ? "" : "missing on this deployment");
    }

    /*
     * The fields that report a reason are asserted, not just printed.
     *
     * Health gained `visionWiring`, `textWiring` and `schema` precisely because a boolean cannot
     * distinguish "not set" from "set wrongly" — and then nothing failed on them, so a wiring
     * fault was something you had to read in passing. The text one matters most: a rejected
     * inference key degrades to the deterministic tier rather than erroring, so it looks like
     * normal operation.
     *
     * Three outcomes. A fault string FAILS; `unconfigured` or `unknown` is NOT CHECKED with its
     * reason, because a tier nobody configured and a tier wired wrongly are different answers and
     * only the second is a deployment fault.
     */
    for (const [key, absent] of [
      ["textWiring", "unconfigured"],
      ["visionWiring", "unconfigured"],
    ]) {
      const value = c[key];
      if (value === undefined) skip(`health: ${key}`, "this build does not report it");
      else if (value === absent) skip(`health: ${key}`, `the tier is ${absent} on this deployment`);
      else record(`health: ${key}`, value === "ok", value === "ok" ? "" : String(value));
    }
    const schema = c.schema;
    if (schema === undefined) skip("health: schema", "this build does not report it");
    else if (String(schema).startsWith("unknown")) skip("health: schema", String(schema));
    else record("health: schema", schema === "ok", schema === "ok" ? "" : String(schema));
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
    ["POST", "/api/import", { url: "https://example.com/x" }],
    ["POST", "/api/photos/reap", {}],
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
  for (const path of ["/", "/sign-in", "/today", "/recipes", "/planner", "/shopping", "/recipes/import", "/household"]) {
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

  /*
   * The shape, not just the happy path.
   *
   * `householdName` and `displayName` are load-bearing: they become user metadata that
   * provisioning reads for the household's name and the member's. Defaulting them would create a
   * household called "Household" and a person with no name on every rating (§5), so the 400 is
   * the right answer — but nothing checked it, and a client sending only email and password got
   * a refusal no run would have caught.
   */
  const thin = await call("POST", "/api/signup", {
    body: { email: `thin-${stamp}@pashki.test`, password: `Thin-${stamp}-Aa1!` },
    auth: false,
  });
  record(
    "signup refuses a request missing the household and the person",
    thin.status === 400,
    `HTTP ${thin.status} — ${String(thin.body?.error ?? "").slice(0, 60)}`,
  );

  // confirm without waiting for mail: this checks the app, not the inbox, and the mail path has
  // its own end-to-end verification in docs/deployment.md
  const users = await admin("GET", "/users?per_page=200");
  const user = (users.users ?? []).find((u) => (u.email ?? "").toLowerCase() === address);
  accountId = user?.id ?? null;
  if (accountId) await admin("PUT", `/users/${accountId}`, { email_confirm: true });
  record("account exists and is confirmable", Boolean(accountId));

  const token = await (await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: address, password: `Smoke-${stamp}-Aa1!` }),
  })).json();
  session = token.access_token ? token : null;
  // the reason, not just the verdict: an unconfirmed account and a wrong password fail alike
  record("can sign in once confirmed", Boolean(session), String(token.error_description ?? token.msg ?? "").slice(0, 90));

  const provisioned = await call("POST", "/api/household", { body: {} });
  familyId = provisioned.body?.familyId ?? null;
  record("provisioning creates a household", provisioned.status === 200 && Boolean(familyId), `HTTP ${provisioned.status}`);

  if (!familyId) throw new Error("no household; the rest cannot be measured");

  // an operator grant, so the write paths below are testing themselves rather than the meter
  await restUpsert("POST", "/entitlements?on_conflict=family_id,app_key", {
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

    /*
     * The calorie estimate, on the screen that shows it.
     *
     * Flour, double cream and lemons all carry a figure, so this recipe is fully covered and the
     * page must state a plain estimate rather than a floor. "at least" appearing here means the
     * catalog lost a figure it had — which is how the estimate would degrade in practice, quietly
     * and while still rendering something plausible.
     */
    /*
     * The plan-it panel, walked in order rather than audited in parts (the three-boundary rule).
     *
     * A day crosses four boundaries here: a tap posts a date, the route writes a `plan_entries`
     * row, the page reads the week back and renders that day as planned, and the circle then
     * carries the row's id so a second tap can delete it. Every hop has its own test and **no
     * component test can see the join** — which is where all four of this project's worst bugs
     * have lived.
     *
     * Asserted on the accessible name, not the class, because the name is the thing that has to
     * be right: "Thursday 23, planned" is a claim about state that a fill colour cannot make.
     *
     * Mid-week on purpose. `family.timezone` decides which Monday the page is showing, and this
     * script computes its date in UTC — a boundary day could legitimately fall in the week either
     * side, which would read as a broken join. Wednesday survives a shift in both directions.
     */
    const midweek = (() => {
      const now = new Date();
      const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) + 2);
      return monday.toISOString().slice(0, 10);
    })();
    const planned = await call("POST", "/api/plan-entries", { body: { recipeId, date: midweek } });
    const entryId = planned.body?.id ?? planned.body?.entry?.id ?? null;
    record("plan the recipe on a day this week", planned.status === 200, `HTTP ${planned.status} ${JSON.stringify(planned.body ?? "").slice(0, 80)}`);

    const dayName = new Date(`${midweek}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    const wanted = `${dayName} ${Number(midweek.slice(8, 10))}, planned`;
    const afterPlan = await call("GET", `/recipes/${recipeId}`);
    const planHtml = typeof afterPlan.body === "string" ? afterPlan.body : "";
    record(
      "and that day reads back as planned on the recipe page",
      planHtml.includes(`aria-label="${wanted}"`),
      planHtml.includes("h-planit")
        ? foundDetail(planHtml, `aria-label="${wanted}"`, `panel rendered without "${wanted}"`)
        : "the panel did not render at all",
    );

    /*
     * Plan → shopping list, walked while the entry exists.
     *
     * This is the product's central join and the one claim its description makes: give a recipe a
     * day and the list writes itself. Three boundaries — a plan entry, `buildShoppingWeek`'s
     * consolidation, and the row on screen — so it gets one walk rather than three component
     * tests, and it is placed here because the plan-it check above has just created a real entry
     * and is about to remove it. A probe owns its fixture.
     */
    const monday = (() => {
      const d = new Date(`${midweek}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    })();
    const list = await call("GET", `/shopping?week=${monday}`);
    const listText = visible(typeof list.body === "string" ? list.body : "");
    record(
      "a planned recipe puts its ingredients on that week's shopping list",
      alive(list) && listText.includes("double cream"),
      alive(list)
        ? foundDetail(listText, "double cream", "the list rendered without the planned recipe's ingredient")
        : `HTTP ${list.status}`,
    );
    record(
      "and says which day takes it, which is what consolidation is for",
      // the day chip: "Wed · 1 pint". Asserted on the weekday rather than the amount, because
      // the amount depends on the household's measurement system and the day does not.
      listText.includes(`${dayName.slice(0, 3)} · `),
      listText.includes("h-buy-split")
        ? foundDetail(listText, `${dayName.slice(0, 3)} · `)
        : "no split row at all",
    );

    /*
     * ---------------------------------------------------------------------------
     * Things typed onto the list, which no recipe asked for (§89)
     * ---------------------------------------------------------------------------
     *
     * Four assertions because the endpoint is the least of them. **A smoke check that calls an
     * endpoint proves the endpoint and nothing else** — caption paste and screenshot upload both
     * shipped green with no way in from the product. So: the route answers, the control is
     * *reachable from the screen*, the typed item reaches the list, and removing it takes it off.
     *
     * **"3 kumquats", and the marker matters more than it looks.** The first version used
     * "2 lemons" — reasoning carefully that a quantity makes it a count line and that lemons are
     * not a staple, and never checking that the fixture recipe above is
     * `"2 cups flour\n1 pint double cream\n3 lemons"`. So "what was typed reaches the list"
     * passed because the *recipe* asks for lemons, and "removing it takes it off" failed because
     * they are still there and always will be. **A stale-fixture probe looks like evidence**: one
     * check read as a pass and the other as the exact failure being hunted. `kumquat` appears
     * nowhere else in this script, the seed catalog or the fixtures.
     *
     * Every assertion also checks the **status**, which the first version did not — so a 500
     * rendered as "the shopping screen offers no way to add anything", which is a claim about the
     * product made from a crash. That is the adjacent-claim fault this project has a list of, and
     * it did in fact happen here: `groupKey: "added"` reached `weekdayName(...).slice(0, 3)`.
     */
    const added = await call("POST", "/api/shopping-extras", {
      body: { text: "3 kumquats", weekStart: monday },
    });
    record(
      "something typed onto the week's list is accepted",
      added.status === 200 && typeof added.body?.id === "string",
      `HTTP ${added.status} ${JSON.stringify(added.body?.text ?? added.body?.error ?? null)}`,
    );

    const withExtra = await call("GET", `/shopping?week=${monday}`);
    const extraText = visible(typeof withExtra.body === "string" ? withExtra.body : "");
    record(
      "and the box to type it in is on the screen, not just the route behind it",
      withExtra.status === 200 && extraText.includes("Anything else you need"),
      withExtra.status !== 200
        ? `HTTP ${withExtra.status} — the screen did not render, so what it offers was not measured`
        : foundDetail(extraText, "Anything else you need", "the shopping screen offers no way to add anything"),
    );
    record(
      "and what was typed reaches the list",
      withExtra.status === 200 && extraText.includes("kumquats"),
      withExtra.status !== 200
        ? `HTTP ${withExtra.status}`
        : foundDetail(extraText, "kumquats", "the typed item did not reach the list it was added to"),
    );

    if (typeof added.body?.id !== "string") {
      skip("and removing it takes it off the list", "nothing was added, so removing it proves nothing");
    } else {
      const removed = await call("DELETE", `/api/shopping-extras?id=${added.body.id}`);
      const after = await call("GET", `/shopping?week=${monday}`);
      const afterText = visible(typeof after.body === "string" ? after.body : "");
      /*
       * The control matters: "lemons" being absent proves nothing if the whole list failed to
       * render. §86 — an assertion that something is missing is worthless without evidence that
       * something else is present.
       */
      const listStillThere = after.status === 200 && afterText.includes("Anything else you need");
      if (!listStillThere) {
        skip(
          "and removing it takes it off the list",
          `the shopping screen did not render (HTTP ${after.status}), so the absence proves nothing`,
        );
      } else {
        record(
          "and removing it takes it off the list",
          removed.status === 200 && !afterText.includes("kumquats"),
          `DELETE ${removed.status} — ${afterText.includes("kumquats") ? "still listed" : "gone, and the list still rendered"}`,
        );
      }
    }

    /*
     * The photograph path's way in, and its refusal — not its reading.
     *
     * **Deliberately not a real extraction.** Reading a photograph costs an inference call and
     * depends on a model seeing a synthetic image, and what it would tell us is whether one model
     * read one fake list once. The accuracy question belongs to an eval against real handwritten
     * lists, which is the corpus this path is waiting on; asserting it here would be a number that
     * looks like a measurement and is not.
     *
     * What smoke can settle is the pair it always can: the control is **reachable from a screen**
     * — caption paste and screenshot upload both shipped green with no way in — and the route
     * **refuses an empty request** rather than answering 200 to nothing.
     */
    record(
      "the shopping screen offers a way to photograph a written list",
      extraText.includes("Or photograph a written list"),
      foundDetail(
        extraText,
        "Or photograph a written list",
        "the route exists and there is no way in from the product",
      ),
    );

    /*
     * A real multipart request, because the mode only exists inside that branch — `call` sends
     * JSON and would fall through to a different refusal, which would pass while testing nothing.
     */
    const emptyForm = new FormData();
    emptyForm.set("mode", "shopping-list");
    const noImages = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, Cookie: sessionCookie(session) },
      body: emptyForm,
      signal: AbortSignal.timeout(90_000),
    });
    const noImagesSaid = await noImages.text();
    record(
      "and reading a list with no photograph is refused, not answered",
      noImages.status >= 400 && noImages.status < 500,
      `HTTP ${noImages.status} ${noImagesSaid.slice(0, 70)}`,
    );

    /*
     * A typed item in a week with **nothing planned**, which is where it used to disappear.
     *
     * regression: `buildShoppingWeek` consolidated the item into `lines` — its own comment says
     * this case must work — and `/shopping` gated the whole list behind `plannedCount > 0`, so the
     * screen said "No list yet", rendered no aisle, and showed the item only inside the add box.
     * Each half correct, the join broken, and no component test can see a join.
     *
     * A far week rather than this one, because the fixture above plans meals into the current week
     * and an empty week has to be genuinely empty to measure anything.
     */
    const emptyWeek = "2027-03-01";
    const loneItem = await call("POST", "/api/shopping-extras", {
      body: { text: "4 kumquat kazoos", weekStart: emptyWeek },
    });
    const loneWeek = await call("GET", `/shopping?week=${emptyWeek}`);
    const loneText = visible(typeof loneWeek.body === "string" ? loneWeek.body : "");
    record(
      "a typed item is a shopping list even with nothing planned",
      loneItem.status === 200 && loneWeek.status === 200
        && loneText.includes("kumquat kazoos") && !loneText.includes("No list yet"),
      loneItem.status !== 200
        ? `POST ${loneItem.status} ${JSON.stringify(loneItem.body?.error ?? null)}`
        : loneWeek.status !== 200
          ? `HTTP ${loneWeek.status} — the screen did not render`
          : loneText.includes("No list yet")
            ? "the screen says No list yet while holding a typed item"
            : foundDetail(loneText, "kumquat kazoos", "the typed item is not on the list"),
    );
    if (typeof loneItem.body?.id === "string") {
      await call("DELETE", `/api/shopping-extras?id=${loneItem.body.id}`);
    }

    /*
     * ---------------------------------------------------------------------------
     * The groups a household makes — Costco, HEB, Trader Joes, Boo Basket (§91)
     * ---------------------------------------------------------------------------
     *
     * **One walk, in order, rather than a check per part.** The value crosses four boundaries —
     * created on `/household`, attached to an item on `/shopping`, renamed back on `/household`,
     * read on `/shopping` — and four of this project's bugs have lived in a join with every hop
     * correct and nothing on the screen. A component test cannot see a handoff by construction.
     *
     * The rename is the assertion that matters, because it is the only thing a table buys over
     * free text: the item must follow the row, not a copy of the string.
     */
    const groupName = `Kumquat Depot ${Date.now().toString(36).slice(-5)}`;
    const madeGroup = await call("POST", "/api/shopping-groups", { body: { name: groupName } });
    record(
      "a group the household makes is accepted",
      madeGroup.status === 200 && typeof madeGroup.body?.id === "string" && madeGroup.body?.created === true,
      `HTTP ${madeGroup.status} ${JSON.stringify(madeGroup.body?.name ?? madeGroup.body?.error ?? null)}`,
    );

    const householdScreen = await call("GET", "/household");
    const householdText = visible(typeof householdScreen.body === "string" ? householdScreen.body : "");
    record(
      "and the screen that manages groups is reachable, not just the route behind it",
      householdScreen.status === 200 && householdText.includes("How you group the list"),
      householdScreen.status !== 200
        ? `HTTP ${householdScreen.status} — the household screen did not render, so what it offers was not measured`
        : foundDetail(householdText, "How you group the list", "the route exists and there is no way in from the product"),
    );

    if (typeof madeGroup.body?.id !== "string") {
      skip("a typed item lands in its group", "no group was made, so attaching to one proves nothing");
      skip("and renaming the group renames it on the list without losing the item", "no group was made");
      skip("and removing the group keeps the thing to buy", "no group was made");
    } else {
      const groupId = madeGroup.body.id;

      /*
       * Typing the **same name again** must return the same group rather than refusing or
       * doubling: somebody typing "costco" on Friday when "Costco" exists means Costco. Asserted
       * on the id, because a matching name proves nothing about which row answered.
       */
      const again = await call("POST", "/api/shopping-groups", { body: { name: groupName.toUpperCase() } });
      record(
        "and typing the same name differently finds that group instead of making a second",
        again.status === 200 && again.body?.id === groupId && again.body?.created === false,
        `HTTP ${again.status} — ${again.body?.id === groupId ? "same group" : `a different id, created=${again.body?.created}`}`,
      );

      const inGroup = await call("POST", "/api/shopping-extras", {
        body: { text: "6 kumquat candles", weekStart: monday, groupId },
      });
      const grouped = await call("GET", `/shopping?week=${monday}`);
      const groupedText = visible(typeof grouped.body === "string" ? grouped.body : "");
      record(
        "a typed item lands in its group",
        inGroup.status === 200 && grouped.status === 200
          && groupedText.includes(groupName) && groupedText.includes("kumquat candles"),
        inGroup.status !== 200
          ? `POST ${inGroup.status} ${JSON.stringify(inGroup.body?.error ?? null)}`
          : grouped.status !== 200
            ? `HTTP ${grouped.status} — the list did not render`
            : `${groupedText.includes(groupName) ? "group shown" : "GROUP MISSING"}, ${groupedText.includes("kumquat candles") ? "item shown" : "ITEM MISSING"}`,
      );

      const renamed = `${groupName} Annexe`;
      const renameSaid = await call("PATCH", "/api/shopping-groups", { body: { id: groupId, name: renamed } });
      const afterRename = await call("GET", `/shopping?week=${monday}`);
      const renamedText = visible(typeof afterRename.body === "string" ? afterRename.body : "");
      /*
       * Both directions, because "the new name is there" would pass with the item orphaned and
       * "the item is there" would pass with the rename lost. The old name must be **gone** — a
       * string copied rather than referenced would leave it behind.
       */
      record(
        "and renaming the group renames it on the list without losing the item",
        renameSaid.status === 200 && afterRename.status === 200
          && renamedText.includes(renamed) && renamedText.includes("kumquat candles"),
        renameSaid.status !== 200
          ? `PATCH ${renameSaid.status} ${JSON.stringify(renameSaid.body?.error ?? null)}`
          : afterRename.status !== 200
            ? `HTTP ${afterRename.status} — the list did not render`
            : `${renamedText.includes(renamed) ? "renamed on the list" : "THE NEW NAME IS NOT ON THE LIST"}, ${renamedText.includes("kumquat candles") ? "item kept" : "THE ITEM WAS ORPHANED"}`,
      );

      const goneGroup = await call("DELETE", `/api/shopping-groups?id=${encodeURIComponent(groupId)}`);
      const afterDelete = await call("GET", `/shopping?week=${monday}`);
      const deletedText = visible(typeof afterDelete.body === "string" ? afterDelete.body : "");
      /*
       * **Deleting a label must never delete a thing to buy.** The control is the item itself:
       * if the whole list failed to render, the group's absence proves nothing (§86), so the
       * item's presence is both the assertion and the evidence that the screen was measured.
       */
      if (afterDelete.status !== 200) {
        skip(
          "and removing the group keeps the thing to buy",
          `the shopping screen did not render (HTTP ${afterDelete.status}), so the absence proves nothing`,
        );
      } else {
        record(
          "and removing the group keeps the thing to buy",
          goneGroup.status === 200 && deletedText.includes("kumquat candles") && !deletedText.includes(renamed),
          `DELETE ${goneGroup.status} — ${deletedText.includes("kumquat candles") ? "the item is still on the list" : "THE ITEM WENT WITH THE LABEL"}, ${deletedText.includes(renamed) ? "and the group is still shown" : "and the group is gone"}`,
        );
      }

      /*
       * -------------------------------------------------------------------
       * Filing a RECIPE-DERIVED line, which is the whole reason for §92
       * -------------------------------------------------------------------
       *
       * One walk across four boundaries, in order: file the item by the key the list rendered →
       * the standing table → `buildShoppingWeek`'s precedence → the screen, and then **a second
       * week**, because standing-not-weekly is the one change from `shopping_ticks`'s shape and a
       * single week cannot tell the two apart.
       *
       * `double cream` comes from the fixture recipe, not from anything typed — under the morning's
       * shape it had no row and could not be grouped at all. On the real week that was 39 of 75
       * lines, so this is the difference between a control on half the list and one on all of it.
       *
       * **Its own group**, because the block above deletes `groupId` and the first version of this
       * filed into it: `PUT 400 "no such group"`, and the two assertions beneath then failed in
       * exactly the shape of the bug being hunted. A probe owns its fixture.
       */
      const shelfName = `Kumquat Warehouse ${Date.now().toString(36).slice(-5)}`;
      const shelf = await call("POST", "/api/shopping-groups", { body: { name: shelfName } });
      const before = await call("GET", `/shopping?week=${monday}`);
      const beforeText = visible(typeof before.body === "string" ? before.body : "");
      const itemCount = (text) => Number((text.match(/(\d+) items? (?:from|\u00b7)/) ?? [])[1] ?? NaN);
      const countBefore = itemCount(beforeText);

      const filed = await call("PUT", "/api/shopping-item-groups", {
        body: { itemKey: "double-cream", groupId: shelf.body?.id },
      });
      const afterFiling = await call("GET", `/shopping?week=${monday}`);
      const filedText = visible(typeof afterFiling.body === "string" ? afterFiling.body : "");
      /*
       * The control is "Anything else you need": if the list did not render, every claim below
       * would be about an absent page (§86).
       */
      if (!(afterFiling.status === 200 && filedText.includes("Anything else you need"))) {
        skip(
          "a recipe's own ingredient can be filed under a group",
          `the shopping screen did not render (HTTP ${afterFiling.status}), so nothing was measured`,
        );
        skip("and it moves rather than being listed twice", "the screen did not render");
      } else {
        const inSection = new RegExp(`${shelfName}[\\s\\S]{0,400}double cream`).test(filedText);
        record(
          "a recipe's own ingredient can be filed under a group",
          filed.status === 200 && inSection,
          filed.status !== 200
            ? `PUT ${filed.status} ${JSON.stringify(filed.body?.error ?? null)}`
            : inSection
              ? "the cream is under the group"
              : foundDetail(filedText, "double cream", "the cream did not move into the group"),
        );
        /*
         * **Moved, not duplicated** — measured by the screen's own item total rather than by
         * counting mentions of the name.
         *
         * The first version counted occurrences of "double cream" and reported `4`, which was
         * never evidence of anything: the label appears in the row's name, in "of double cream",
         * and in the checkbox's own label, filed or not. The total is one number a person can
         * check against the rows, and the fault this replaces — an item in its aisle *and* under a
         * group — would raise it by one.
         */
        const countAfter = itemCount(filedText);
        record(
          "and it moves rather than being listed twice",
          Number.isFinite(countBefore) && countBefore === countAfter,
          !Number.isFinite(countBefore) || !Number.isFinite(countAfter)
            ? `could not read the item total (${countBefore} then ${countAfter})`
            : `${countBefore} items before, ${countAfter} after`,
        );
      }

      /*
       * Standing, not weekly: the same assignment holds on a week nothing was filed for. This is
       * the assertion that distinguishes §92 from a copy of `shopping_ticks`.
       */
      const otherWeek = "2027-02-01";
      const alsoThere = await call("POST", "/api/shopping-extras", {
        body: { text: "1 pint double cream", weekStart: otherWeek },
      });
      const next = await call("GET", `/shopping?week=${otherWeek}`);
      const nextText = visible(typeof next.body === "string" ? next.body : "");
      record(
        "and where an item is bought holds on every week, not just the one it was filed on",
        alsoThere.status === 200 && next.status === 200
          && new RegExp(`${shelfName}[\\s\\S]{0,400}double cream`).test(nextText),
        next.status !== 200
          ? `HTTP ${next.status} — the other week did not render`
          : foundDetail(nextText, shelfName, "the group did not carry to another week"),
      );
      if (typeof alsoThere.body?.id === "string") {
        await call("DELETE", `/api/shopping-extras?id=${alsoThere.body.id}`);
      }

      /*
       * The tick follows the item, because the key never moved. Keys were namespaced by group for
       * one morning (`g:<id>:<key>`), which would have orphaned a tick on every regroup; an item is
       * in exactly one group, so it is one line with one identity.
       *
       * Both halves asserted: the item is under its **new** group and the trolley still holds it.
       * Checking only the trolley would pass over a refile that did nothing at all.
       */
      const tickedIt = await call("POST", "/api/shopping-ticks", {
        body: { weekStart: monday, itemKey: "double-cream" },
      });
      const annexe = `${shelfName} Annexe`;
      const refiled = await call("PUT", "/api/shopping-item-groups", {
        body: { itemKey: "double-cream", groupName: annexe },
      });
      const stillTicked = await call("GET", `/shopping?week=${monday}`);
      const tickText = visible(typeof stillTicked.body === "string" ? stillTicked.body : "");
      const moved = new RegExp(`${annexe}[\\s\\S]{0,400}double cream`).test(tickText);
      record(
        "and a tick survives the item being refiled, because the key does not move",
        tickedIt.status === 200 && refiled.status === 200 && stillTicked.status === 200
          && moved && /1 in the trolley/.test(tickText),
        tickedIt.status !== 200
          ? `tick ${tickedIt.status}`
          : refiled.status !== 200
            ? `refile ${refiled.status} ${JSON.stringify(refiled.body?.error ?? null)}`
            : !moved
              ? "the refile did not move the item, so the surviving tick proves nothing"
              : foundDetail(tickText, "1 in the trolley", "the tick was lost when the item was refiled"),
      );

      // leave the household as it was found: the item goes back to no group
      await call("PUT", "/api/shopping-item-groups", { body: { itemKey: "double-cream" } });

      if (typeof inGroup.body?.id === "string") {
        await call("DELETE", `/api/shopping-extras?id=${inGroup.body.id}`);
      }
    }

    /*
     * Item 3: what the day row holds AT REST, asserted by absence.
     *
     * The fix is not "the panel exists" — it is that four controls are *not* in the row until
     * asked for, and a presence check cannot see that. So this asserts the planned row carries
     * the title and the cooked mark, and carries **neither** the Move select nor the remove
     * button. Checked here because the plan-it walk has just put a real meal on a real day; with
     * no planned entry the row renders "+ Add dinner" and every absence below would pass
     * vacuously, which is a probe that could not have failed.
     */
    const week = await call("GET", `/planner?week=${monday}`);
    const weekText = visible(typeof week.body === "string" ? week.body : "");
    const hasRow = weekText.includes("Smoke Test Pie") && weekText.includes("h-cooked-mark");
    record(
      "the planned meal is on the planner's day row",
      alive(week) && hasRow,
      alive(week) ? foundDetail(weekText, "Smoke Test Pie", "no planned row to measure — the absences below would pass vacuously") : `HTTP ${week.status}`,
    );
    if (hasRow) {
      record(
        "and the row at rest does not carry Move or remove",
        !weekText.includes("Move to another day") && !weekText.includes("Take it off"),
        weekText.includes("Move to another day")
          ? "the Move select is still in the row at rest"
          : weekText.includes("Take it off")
            ? "the remove button is still in the row at rest"
            : "both absent, as intended",
      );
      /*
       * Where the planner's title goes, which depends on the day.
       *
       * The plan-it walk puts its meal mid-week, so for most of the week this row is NOT today
       * and its title must point at the recipe. Asserted both ways round where it can be: the
       * recipe href is always present (the panel carries one), and the cook href appears only on
       * today's row — so on a day that is not today, "tap to cook" must be absent.
       */
      const isToday = midweek === new Date().toISOString().slice(0, 10);
      record(
        "the planner links to the recipe with the plan entry, so scaled servings survive",
        weekText.includes(`/recipes/${recipeId}?planned=`),
        foundDetail(weekText, `/recipes/${recipeId}?planned=`),
      );
      record(
        isToday
          ? "today's meal title opens cook mode"
          : "a future meal does not offer cook mode from its title",
        isToday
          ? weekText.includes(`/cook/${recipeId}?planned=`) && weekText.includes("tap to cook")
          : !weekText.includes("tap to cook"),
        isToday ? foundDetail(weekText, "tap to cook") : "no cook cue on a day that is not today",
      );
      /*
       * Is the drag handler bound at all?
       *
       * `onPointerDown` reads `element.dataset.entryId` and returns immediately without it, so
       * the attribute is the one observable proof from outside that the gesture is wired to a
       * real entry. "Press and hold does nothing" has no other fingerprint — there is no error,
       * no log and no failed request — so this is the only part of that report a check can reach.
       */
      record(
        "and the row's disclosure starts closed",
        weekText.includes('aria-expanded="false"'),
        foundDetail(weekText, 'aria-expanded="false"'),
      );
    }

    /*
     * §85: the layout setting, and the three states its two columns exist to tell apart.
     *
     * `recipe_layout` says what to render; `recipe_layout_asked_at` says whether to ask. A
     * dismissal stamps the second and leaves the first, which is the only way "not now" can differ
     * from "never asked" — and conflating them would re-prompt somebody forever.
     *
     * Per **person** since §87, which is why the per-member half is a separate block further down:
     * these run as the owner, and a check that only ever runs as the owner is what let an invited
     * member read five of nine columns for five months.
     */
    const settingPage = await call("GET", "/household");
    const settingText = visible(typeof settingPage.body === "string" ? settingPage.body : "");
    /*
     * The **first** option in the radiogroup is the one that must be checked, and that is asserted
     * by order rather than by proximity. A first version matched `aria-checked="true"` within 400
     * characters of the label and failed against correct markup: the preview diagram sits between
     * them and the real distance is about **620**. A window is a guess about a spelling, and this
     * project has a rule about those.
     */
    const options = [...settingText.matchAll(/aria-checked="(true|false)"/g)].map((m) => m[1]);
    const defaultChecked = options.length === 5 && options[0] === "true" && !options.slice(1).includes("true");
    record(
      "somebody who has never been asked starts on the default layout",
      settingPage.status === 200 && defaultChecked,
      settingPage.status !== 200
        ? `HTTP ${settingPage.status}`
        : defaultChecked
          ? `5 options, the first checked: ${options.join(",")}`
          : settingText.includes("We cook the same things")
            ? `the setting rendered with ${options.length} option(s) checked as ${options.join(",") || "nothing"}`
            : "the setting did not render at all",
    );

    const chose = await call("PATCH", "/api/household", { body: { recipeLayout: "browse" } });
    record(
      "a person can say how they decide what to cook",
      chose.status === 200 && chose.body?.recipeLayout === "browse" && Boolean(chose.body?.recipeLayoutAskedAt),
      `HTTP ${chose.status} layout=${chose.body?.recipeLayout} asked=${Boolean(chose.body?.recipeLayoutAskedAt)}`,
    );

    /*
     * ---------------------------------------------------------------------------
     * The recipe book, now that this household is on `browse` (§86)
     * ---------------------------------------------------------------------------
     *
     * The layout was just set above, so this is the one place in the suite where the contents
     * page actually renders. Four things, and the third is the one no stylesheet check can reach.
     */
    const contents = visible(String((await call("GET", "/recipes")).body ?? ""));
    record(
      "browse renders the recipe book's contents page, not a flat list",
      contents.includes("The Lundall Recipe Book") && contents.includes("h-contents-grid"),
      foundDetail(contents, "The Lundall Recipe Book"),
    );
    /*
     * Masked, not drawn. An `<img>` onto `public/chapters` bakes the ink in and renders at
     * 1.01:1 on the dark surface — invisible in cook mode, with every build guard green.
     * `check-chapter-icons.mjs` catches it in the source; this catches it **as served**, which
     * is the half a laptop cannot vouch for.
     */
    const maskedIcon = /--chapter-icon:\s*url\(\/chapters\//.test(contents);
    const drawnIcon = /<img[^>]*\/chapters\//.test(contents);
    record(
      "and its icons are masked from a token, never an <img> with the ink baked in",
      maskedIcon && !drawnIcon,
      drawnIcon ? "an <img> reaches /chapters — invisible in dark" : maskedIcon ? "masked" : "no chapter icon served at all",
    );

    /*
     * The subdivision **rule**, not the outcome — because the outcome depends on the data.
     *
     * A first version asserted that Mains divides, and failed against entirely correct behaviour:
     * this household has two mains, and dividing two recipes into protein groups would be the
     * bug. An assertion that only holds for a fixture it does not create is a probe that measures
     * the fixture. So read the count the page states and assert the implication in both
     * directions — over seven divides, seven or fewer lists. That holds on any library.
     *
     * Only one branch of it runs here, though, and saying so is the point: this household has no
     * mains, so the *divides* side is never exercised by smoke. `pnpm shots` builds a library with
     * nine mains and renders the divided screen in both themes, which is where that half is
     * covered. Two probes, one rule, and neither of them pretending to be both.
     */
    const mainsPage = visible(String((await call("GET", "/recipes/c/main")).body ?? ""));
    const mainsCount = Number(/(\d+)\s+recipes?/.exec(mainsPage)?.[1] ?? NaN);
    const divided = mainsPage.includes("h-mains-grid");
    record(
      "a chapter divides exactly when it has an axis and outgrows a screen",
      Number.isFinite(mainsCount) && divided === mainsCount > 7,
      !Number.isFinite(mainsCount)
        ? "Mains did not render its own count"
        : `${mainsCount} mains, ${divided ? "divided" : "listed"}`,
    );

    const unknown = await call("GET", "/recipes/c/nonsense");
    record(
      "and an unknown chapter is a 404 rather than a silent fall back to Mains",
      unknown.status === 404,
      `HTTP ${unknown.status}`,
    );

    const refused = await call("PATCH", "/api/household", { body: { recipeLayout: "shelves" } });
    record(
      "and a layout no screen renders is refused, not stored",
      // 'shelves' was ideated and dropped; the CHECK is what refuses it, and a 500 here would
      // mean the constraint surfaced as a crash instead of a message
      refused.status >= 400 && refused.status < 500,
      `HTTP ${refused.status} ${String(refused.body?.error ?? "").slice(0, 60)}`,
    );

    const dismissed = await call("PATCH", "/api/household", { body: { recipeLayout: null } });
    record(
      "and dismissing the question keeps the layout it already had",
      dismissed.status === 200 && dismissed.body?.recipeLayout === "browse" && Boolean(dismissed.body?.recipeLayoutAskedAt),
      `HTTP ${dismissed.status} layout=${dismissed.body?.recipeLayout}`,
    );

    /*
     * The slot, written for the first time.
     *
     * `plan_entries.slot` has existed since §slot with a CHECK of breakfast / lunch / dinner /
     * snack, and **all 40 live entries were 'dinner'** because no route ever sent the column —
     * the default did all the work. So this is the first exercise of it, and the first time the
     * CHECK has had a chance to refuse anything.
     *
     * Three assertions, because the interesting one is the third: a recipe at breakfast AND at
     * dinner on one day is two meals, not a duplicate — `(date, slot)` is the meal — and the
     * already-planned guard had no slot in it until now.
     */
    /*
     * A day of its own, not `midweek` — the plan-it walk above has a dinner sitting there, so a
     * dinner written here would be refused as already-planned and the 409 would read as the slot
     * guard being wrong. **A probe owns its fixture**: this one got that wrong on its first run
     * and reported a correct refusal as a failure.
     */
    const otherDay = (() => {
      const d = new Date(`${midweek}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    /*
     * The tab scopes the screen, which is the whole of fault 2 — v1's slot set what got written
     * and not what got shown, so choosing breakfast offered dinners. Asserted by difference: the
     * two tabs must not render the same heading.
     */
    /*
     * Breakfast is asserted on the THIRD empty state rather than on a heading: this household owns
     * no breakfast recipes, so there is nothing to rank and nothing to list, and the honest screen
     * says "No breakfasts in your recipes yet". Asserting the heading here would have demanded a
     * leaderboard for a course with no members — a check that can only pass on somebody else's
     * data.
     */
    for (const [tab, wanted] of [["breakfast", "No breakfasts in your recipes yet"], ["dinner", "Dinners everyone likes"]]) {
      const page = await call("GET", `/today?slot=${tab}`);
      const text = visible(typeof page.body === "string" ? page.body : "");
      record(
        `the ${tab} tab shows ${tab} content and says so`,
        page.status === 200 && text.includes(wanted),
        page.status === 200 ? foundDetail(text, wanted) : `HTTP ${page.status}`,
      );
    }
    const dinnerTab = visible(String((await call("GET", "/today?slot=dinner")).body ?? ""));
    const snackTab = visible(String((await call("GET", "/today?slot=snack")).body ?? ""));
    record(
      "and two tabs do not render the same screen",
      dinnerTab !== snackTab,
      dinnerTab === snackTab ? "both tabs rendered byte-identical output" : "they differ",
    );

    const breakfast = await call("POST", "/api/plan-entries", {
      body: { recipeId, date: otherDay, slot: "breakfast" },
    });
    record(
      "a meal can be planned at a slot other than dinner",
      breakfast.status === 200,
      `HTTP ${breakfast.status} ${JSON.stringify(breakfast.body ?? "").slice(0, 70)}`,
    );
    const badSlot = await call("POST", "/api/plan-entries", {
      body: { recipeId, date: otherDay, slot: "elevenses" },
    });
    record(
      "and a slot outside the four is refused with a message, not a 500",
      badSlot.status === 400,
      `HTTP ${badSlot.status} ${String(badSlot.body?.error ?? "").slice(0, 60)}`,
    );
    if (breakfast.body?.id) {
      /*
       * The same recipe at dinner on the same day: a second meal, so a 200. A 409 here would mean
       * the guard is still treating a day as a meal.
       */
      const alsoDinner = await call("POST", "/api/plan-entries", {
        body: { recipeId, date: otherDay, slot: "dinner" },
      });
      record(
        "and the same recipe at two slots on one day is two meals, not a duplicate",
        alsoDinner.status === 200,
        `HTTP ${alsoDinner.status}`,
      );
      if (alsoDinner.body?.id) await call("DELETE", `/api/plan-entries/${alsoDinner.body.id}`);
      await call("DELETE", `/api/plan-entries/${breakfast.body.id}`);
    } else {
      record("and the same recipe at two slots on one day is two meals, not a duplicate", null, "the breakfast write did not return an id");
    }

    /*
     * And off again, which is the hop that would fail silently.
     *
     * The id reaching the circle is the only way a second tap can unplan anything; render it with
     * a null id and the panel looks identical and quietly plans a duplicate instead.
     */
    if (entryId) {
      const removed = await call("DELETE", `/api/plan-entries/${entryId}`);
      const afterRemove = await call("GET", `/recipes/${recipeId}`);
      const removeHtml = typeof afterRemove.body === "string" ? afterRemove.body : "";
      record(
        "and tapping it again takes it off the week",
        removed.status === 200 && removeHtml.includes(`aria-label="${dayName} ${Number(midweek.slice(8, 10))}, not planned"`),
        `DELETE ${removed.status}`,
      );
    } else {
      record("and tapping it again takes it off the week", null, "no entry id came back from the POST");
    }

    /*
     * Cook mode (§4.3), and the first check is the one that has caught real failures twice:
     * **is there a way in from the product.** Caption paste and screenshot upload both had green
     * route checks and no entry point — "verified against production" was true and meaningless.
     * A route answering is not a feature, so the link is asserted on the page a person is
     * actually standing on before anything else is believed about the screen.
     */
    const recipePage = await call("GET", `/recipes/${recipeId}`);
    const recipeHtml = typeof recipePage.body === "string" ? recipePage.body : "";
    record(
      "the recipe page offers a way into cook mode",
      recipeHtml.includes(`/cook/${recipeId}`) && recipeHtml.includes("Cook now"),
      foundDetail(recipeHtml, `/cook/${recipeId}`, "no /cook link on the recipe page"),
    );

    const cook = await call("GET", `/cook/${recipeId}`);
    const cookHtml = typeof cook.body === "string" ? cook.body : "";
    const cookText = visible(cookHtml);
    record("cook mode renders", alive(cook), `HTTP ${cook.status}`);
    for (const [what, needle] of [
      ["is dark by class rather than by script", 'class="h-cook"'],
      ["counts the steps it has", "Step 1 of 2"],
      // the §5 degradation: the whole list, labelled as the whole list
      ["shows the full ingredient list", "All ingredients"],
      ["does not claim a per-step card it has no data for", null],
      ["offers a 60px Next", "Next step"],
      ["has a way out", "Close cook mode"],
    ]) {
      if (needle === null) {
        record(
          what,
          !/FOR THIS STEP|For this step/i.test(cookText),
          /For this step/i.test(cookHtml) ? 'the page says "for this step" — it cannot know that' : "absent, as intended",
        );
        continue;
      }
      const found = cookHtml.includes(needle) || cookText.includes(needle);
      record(`and ${what}`, found, foundDetail(found ? needle : "", needle));
    }

    /*
     * A step in the URL resumes there. Asserted because the whole point of `replaceState` is that
     * a reload mid-recipe does not start the method again, and nothing else would notice.
     */
    const resumed = await call("GET", `/cook/${recipeId}?step=2`);
    const resumedHtml = typeof resumed.body === "string" ? resumed.body : "";
    record(
      "a step in the URL is where cooking resumes",
      // server-rendered at step 1 and corrected on mount, so the assertion is that the URL
      // survives to the client rather than that the server honoured it
      alive(resumed) && visible(resumedHtml).includes("Step 1 of 2"),
      `HTTP ${resumed.status}`,
    );

    const detail = await call("GET", `/recipes/${recipeId}`);
    const page = typeof detail.body === "string" ? detail.body : JSON.stringify(detail.body);
    record("the recipe page renders", alive(detail), `HTTP ${detail.status}`);
    record(
      "and shows a calorie estimate per serving",
      page.includes("kcal") && page.includes("per serving"),
      page.includes("No calorie estimate") ? "the page declined to state one" : "",
    );
    record(
      "and states it as an estimate rather than a floor, since every ingredient is catalogued",
      page.includes("kcal") && !page.includes("at least"),
      page.includes("at least") ? "something in the catalog lost its energy figure" : "",
    );

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

  /*
   * The scheduler's door, moved rather than deleted.
   *
   * This used to point at `/api/import/drain`, and it was the check that caught a shared secret
   * set on both sides and *differing* — the queue never drained while smoke was green, because
   * the route accepted a session and refused the secret. The drain is retired
   * (20260912120000) and the **photo reaper** now authenticates with the same
   * `PASHKI_DRAIN_SECRET` through the same `machineCaller`, so the coverage belongs there.
   *
   * Losing it with the drain would have retired the only thing verifying that machine auth
   * works at all — and "presence is not agreement" is exactly what it exists to prove.
   */
  if (E.PASHKI_DRAIN_SECRET) {
    const asScheduler = await fetch(`${base}/api/photos/reap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pashki-drain-secret": E.PASHKI_DRAIN_SECRET },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(90_000),
    });
    record(
      "the reaper accepts the scheduler's secret",
      asScheduler.status === 200,
      asScheduler.status === 401
        ? "401 — the secret on the host differs from the one the scheduler presents"
        : `HTTP ${asScheduler.status}`,
    );

    const asStranger = await fetch(`${base}/api/photos/reap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pashki-drain-secret": "not-the-secret" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(90_000),
    });
    record(
      "and refuses a wrong one",
      asStranger.status === 401,
      `HTTP ${asStranger.status}`,
    );
  } else {
    skip("the reaper accepts the scheduler's secret", "PASHKI_DRAIN_SECRET is not in the environment");
  }

  /*
   * The retired batch surface must be gone, not merely unused.
   *
   * A route left behind is a route somebody can still reach, and the reason for retiring this
   * was that it never worked. 404 is the assertion — a 200 would mean the door is still open,
   * and a 500 would mean it is open and broken.
   */
  for (const [name, path, method] of [
    ["the batch import route", "/api/import/batch", "POST"],
    ["the drain route", "/api/import/drain", "POST"],
    ["the job list route", "/api/import/jobs", "GET"],
  ]) {
    const gone = await call(method, path, method === "POST" ? { body: {} } : {});
    record(`${name} is gone`, gone.status === 404, `HTTP ${gone.status}`);
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
    // kept for later blocks: the child below is REMOVED at the end of this section, so anything
    // needing a live member has to use the adult. The preference checks used the child and got a
    // correct 404 from a correct route — the test was wrong, not the code.
    adultMemberId = mine ?? null;
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
  const inviteeAccount = await admin("POST", "/users", {
    email: invitedAddress, password: invitedPassword, email_confirm: true,
  });
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

  /*
   * ---------------------------------------------------------------------------
   * Can two members of one household hold different settings, and see their own?
   * ---------------------------------------------------------------------------
   *
   * **Nothing tested this, which is why it reached a person.** Every household-setting check here
   * ran as the owner, and the owner's read goes through a different branch of
   * `findFamilyForAccount` than an invited member's. That second branch hand-wrote five of nine
   * columns, so an invited member resolved `timezone`, `avoided_allergens`, `kroger_location_id`
   * and `recipe_layout` as absent — and the defaults dressed the absences as choices.
   *
   * The shape of the check is the point: set as one member, read back as a *different* member of
   * the same household, and assert the first member's value is unchanged. A single-member
   * assertion cannot see a resolver that is wrong for everybody except whoever wrote it.
   *
   * **Two kinds of setting, and the assertions point opposite ways.** The allergen list is
   * household-wide — one kitchen, one dinner (§71) — so a second member must read what the first
   * one stored. The layout is personal since §87, so a second member must read their *own*. The
   * two halves below are not variations on one check; one of them asserts sharing and the other
   * asserts isolation, and the resolver bug would have failed both.
   *
   * Signed in as the invitee with the password minted above — the account is a real member of this
   * household, so this is the product's own path and not an admin read.
   */
  if (invitedAccountId) {
    const inviteeToken = await (await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: invitedAddress, password: invitedPassword }),
    })).json();

    if (!inviteeToken.access_token) {
      skip(
        "two members of one household: shared settings shared, personal settings their own",
        `could not sign in as the invitee — ${String(inviteeToken.error_description ?? inviteeToken.msg ?? "").slice(0, 60)}`,
      );
    } else {
      const asInvitee = async (method, path, body) => {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${inviteeToken.access_token}`,
            Cookie: sessionCookie(inviteeToken),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        });
        const text = await response.text();
        try {
          return { status: response.status, body: JSON.parse(text) };
        } catch {
          return { status: response.status, body: text };
        }
      };

      /*
       * The member's settings are read from the **screen**, because there is no GET on
       * /api/household and because the screen is the thing that was wrong. An endpoint answering
       * is not a feature; here it is not even available, so asserting on one would have meant
       * adding an endpoint in order to test a page. `visible()` strips React's SSR comments —
       * a static string beside an interpolated one arrives as `1<!-- --> hidden:`.
       */
      const screenAsInvitee = async (path) => {
        const response = await fetch(`${base}${path}`, {
          headers: {
            Authorization: `Bearer ${inviteeToken.access_token}`,
            Cookie: sessionCookie(inviteeToken),
          },
          signal: AbortSignal.timeout(90_000),
        });
        return { status: response.status, text: visible(await response.text()) };
      };

      /*
       * ---------------------------------------------------------------------------
       * The layout: two members of one household, two answers (§87, brief 1c)
       * ---------------------------------------------------------------------------
       *
       * The assertion here **inverted** when the column moved, and that is worth saying plainly
       * because the old one looked like a stronger check than it was. It asserted that a member
       * reads *the household's* layout, which was the right assertion against the broken resolver
       * and the wrong one about the product: Stephen choosing the recipe book changed what Paige
       * saw, and Paige is the one who cooks from it. So the same two fetches now prove the
       * opposite, and a single-member check could not have told the two apart.
       *
       * Three steps, which is what the brief asked for: set as one member, read as a second
       * member of the same household, and assert the first member's is unchanged.
       *
       * **This assertion's direction depends on a design decision, and it has already reversed
       * once.** It is here because a test can encode the bug as the specification: the previous
       * version asserted the member reads the *household's* layout, was green throughout, and
       * would have defended the fault against the fix. If the layout ever becomes shared again,
       * this block does not need a better instrument — it needs reversing, deliberately. Anyone
       * who makes it fail should check which of the two they changed before assuming a break.
       */
      const owners = await call("PATCH", "/api/household", { body: { recipeLayout: "browse" } });
      record(
        "the owner sets their own layout",
        owners.status === 200 && owners.body?.recipeLayout === "browse",
        `HTTP ${owners.status} — ${JSON.stringify(owners.body?.recipeLayout ?? null)}`,
      );

      /*
       * The claim is an **absence** — the member does not get the owner's layout — so it needs a
       * control in the same breath, or it passes whenever the marker is missing for any reason at
       * all (§86). The control is the owner's own screen, read here rather than relied on from the
       * earlier block: same library, same moment, same marker.
       *
       * The marker is the contents page's title. A first version also required the member's screen
       * to carry the rotation heading, and that failed against entirely correct behaviour — this
       * household's library is small enough that rotation renders the empty-cookbook state instead
       * of its heading. So the rotation marker is reported as evidence and never gated on: it is a
       * property of the library, not of the setting.
       */
      const BROWSE = "The Lundall Recipe Book";
      const ownerSees = visible(String((await call("GET", "/recipes")).body ?? ""));
      const memberBefore = await screenAsInvitee("/recipes");
      const memberOnBrowse = memberBefore.text.includes(BROWSE);

      if (!ownerSees.includes(BROWSE)) {
        skip(
          "a second member is not moved onto the layout the owner chose",
          `the owner's own /recipes does not carry "${BROWSE}" either, so the member's not carrying it proves nothing`,
        );
      } else {
        record(
          "a second member is not moved onto the layout the owner chose",
          memberBefore.status === 200 && !memberOnBrowse,
          `HTTP ${memberBefore.status} — the owner's /recipes carries the contents page and the member's ${
            memberOnBrowse
              ? "DOES TOO, having never chosen it — the bug"
              : `does not${memberBefore.text.includes("What you cook") ? ", and carries the rotation heading instead" : ""}`
          }`,
        );
      }

      /*
       * And the question is per person, which is the half `recipe_layout_asked_at` exists for.
       *
       * Measured rather than assumed: the card only appears above `AT_A_TIME` recipes, so a small
       * library would fail this for a reason that has nothing to do with the claim. A library too
       * small to prompt reports NOT MEASURED — absence and emptiness are indistinguishable, and
       * this project has paid for reading one as the other.
       */
      const PROMPT = "How do you usually pick one?";
      const askedBefore = memberBefore.text.includes(PROMPT);

      /*
       * The member answers, and both answers stand at once. This is the assertion the household
       * column could not pass at all: one column cannot hold two values.
       */
      const memberChose = await asInvitee("PATCH", "/api/household", { recipeLayout: "browse" });
      record(
        "the member can choose for themselves",
        memberChose.status === 200 && memberChose.body?.recipeLayout === "browse",
        `HTTP ${memberChose.status} — ${JSON.stringify(memberChose.body?.recipeLayout ?? null)}`,
      );

      /*
       * One rule, asserted in both directions: the card appears for somebody who has not answered
       * and is gone once they have. One direction alone would pass with the stamp ignored — a card
       * that never appears satisfies "gone after", and a card that always appears satisfies
       * "present before".
       */
      if (!askedBefore) {
        skip(
          "the member is asked even though the owner answered, and asked only once",
          "this household's library is below the prompt threshold, so the card could not appear for anybody",
        );
      } else {
        const memberAfter = await screenAsInvitee("/recipes");
        record(
          "the member is asked even though the owner answered, and asked only once",
          memberAfter.status === 200 && !memberAfter.text.includes(PROMPT),
          `HTTP ${memberAfter.status} — the card was offered before the member answered and is ${
            memberAfter.text.includes(PROMPT) ? "STILL offered after" : "gone after"
          }; the owner had already answered`,
        );
      }

      const ownerBack = await call("PATCH", "/api/household", { body: { recipeLayout: null } });
      record(
        "and the owner's layout is untouched by what the member chose",
        ownerBack.status === 200 && ownerBack.body?.recipeLayout === "browse",
        `HTTP ${ownerBack.status} — the owner still reads ${JSON.stringify(ownerBack.body?.recipeLayout ?? null)}, wanted "browse"`,
      );

      /*
       * ---------------------------------------------------------------------------
       * A spent invitation is not a dead end for the person who spent it
       * ---------------------------------------------------------------------------
       *
       * Reported as "signed out every time she closes the app", and it was not a session fault:
       * her home-screen icon pointed at `/invite/[token]`. Every launch loaded a spent token, was
       * correctly told the invitation had been used, and offered only "Sign in" — which she
       * already was. Three correct eliminations (cookies, client, middleware) and the cause was a
       * bookmark.
       *
       * The token is never returned by the API — there is a check above asserting exactly that —
       * so this mints one: `token_hash` is sha256 of the token in hex, so setting the hash of a
       * string we chose makes the already-accepted invitation reachable at a URL we know. That is
       * a service-role write to a platform table, which is what this script already does for
       * provisioning and acceptance.
       *
       * `fetch` follows the redirect, so the assertion is on **where she lands** rather than on a
       * 3xx: the recipe screen's own content, and the spent-token sentence absent. A status code
       * would not distinguish a redirect into the app from a redirect back to sign-in.
       */
      const mintedToken = `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const mintedHash = createHash("sha256").update(mintedToken, "utf8").digest("hex");
      let reachable = true;
      try {
        await rest("PATCH", `/invitations?id=eq.${invited.body?.invitation?.id}`, {
          token_hash: mintedHash,
        });
      } catch {
        reachable = false;
      }

      if (!reachable) {
        skip(
          "a member who opens their own spent invitation is sent into the app",
          "could not re-key the invitation, so the spent-token page was not reached",
        );
      } else {
        const spent = await screenAsInvitee(`/invite/${mintedToken}`);
        const landedInApp = spent.text.includes("What you cook") || spent.text.includes("The Lundall Recipe Book");
        const toldItIsSpent = spent.text.includes("already been used");
        record(
          "a member who opens their own spent invitation is sent into the app",
          spent.status === 200 && landedInApp && !toldItIsSpent,
          `HTTP ${spent.status} — ${
            toldItIsSpent
              ? "still told the invitation is spent, which is the bookmark loop"
              : landedInApp
                ? "landed on the recipe screen"
                : "landed somewhere that is neither the app nor the spent-token page"
          }`,
        );
      }

      /*
       * And the other dead end: a token that was never real. A signed-in visitor there is offered
       * "Sign in", an instruction to do what they have already done — the same fault one branch
       * along, and the one a member of *another* household would hit.
       */
      const nonsense = await screenAsInvitee("/invite/not-a-real-token-at-all");
      record(
        "and an unrecognised invitation offers a signed-in visitor the app, not a sign-in",
        nonsense.status === 200 && nonsense.text.includes("Open Pashki") && !nonsense.text.includes("Sign in"),
        `HTTP ${nonsense.status} — offers ${
          nonsense.text.includes("Open Pashki") ? '"Open Pashki"' : ""
        }${nonsense.text.includes("Sign in") ? ' "Sign in" (wrong for a signed-in visitor)' : ""}`.trim(),
      );

      /*
       * The allergen list is the expensive one and it is asserted separately, because an empty
       * array is exactly what the broken read produced — and `[]` compares equal to a household
       * that genuinely avoids nothing. Set two, so the assertion cannot pass on an absence.
       */
      await call("PATCH", "/api/household", { body: { avoidedAllergens: ["peanut", "wheat"] } });
      const asMember = await screenAsInvitee("/household");
      /*
       * Read off /household, where the control renders what it believes is avoided — which is
       * exactly the value it used to PATCH back. `aria-pressed="true"` marks a chosen allergen,
       * and a control showing none while two are stored is the fault that erased a real list.
       */
      /*
       * ---------------------------------------------------------------------------
       * Stored against rendered, as sets — not a count, and not of the whole page
       * ---------------------------------------------------------------------------
       *
       * This was `aria-pressed="true"` counted across the entire document and compared with
       * `>= 2`, under a name that promised it "shows what is stored". Two faults, and the run's
       * own output printed the evidence: **"3 allergen(s) shown as chosen, stored 2"**.
       *
       * The third was the **units control**, which carries `aria-pressed` too. So the count was
       * over two unrelated controls, and `>=` meant the assertion would have passed with *no*
       * allergen chosen at all as long as something else on the page was pressed. The check that
       * stands for the §87 fix — a member's control showing an empty list it would then write
       * back — could not have failed for the reason it exists.
       *
       * Scoping it is the fix rather than waiting for the count to settle: migrating units to
       * `SegmentedControl` keeps its `aria-pressed`, so the pollution does not go away.
       */
      /*
       * Matched by the **allergen vocabulary**, not by a container.
       *
       * A first version scoped with `class="allergens"[\s\S]*?</div>\s*</div>` — a guess about
       * nesting depth and about whether React emits whitespace between the closing tags, which is
       * the "a window is a guess about a spelling" mistake this project has paid for. The nine
       * labels are a closed set, so matching them is order-independent, nesting-independent, and
       * cannot pick up the units control, whose segments say "US" and "Metric".
       */
      const ALLERGEN_LABELS = [
        "Peanuts", "Tree nuts", "Milk & dairy", "Eggs", "Fish",
        "Shellfish", "Soy", "Wheat & gluten", "Sesame",
      ];
      const pressedState = (label) => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return asMember.text.match(new RegExp(`aria-pressed="(true|false)"[^>]*>\\s*${escaped}\\s*<`))?.[1] ?? null;
      };
      const states = new Map(ALLERGEN_LABELS.map((label) => [label, pressedState(label)]));
      const renderedOn = new Set([...states].filter(([, on]) => on === "true").map(([label]) => label));
      const storedLabels = new Set(["Peanuts", "Wheat & gluten"]);
      const agree =
        renderedOn.size === storedLabels.size && [...storedLabels].every((label) => renderedOn.has(label));

      if ([...states.values()].every((state) => state === null)) {
        /*
         * The control did not render, so "nothing is pressed" says nothing about the read.
         * Absence and emptiness are indistinguishable, and an empty set looked like a real answer
         * once already — that is the whole of §87.
         */
        skip(
          "the member's own allergen control shows exactly what is stored",
          "no allergen button rendered on the member's /household, so what it shows was not measured",
        );
      } else {
        record(
          "the member's own allergen control shows exactly what is stored",
          asMember.status === 200 && agree,
          `HTTP ${asMember.status} — stored {${[...storedLabels].join(", ")}}, rendered {${
            [...renderedOn].join(", ") || "nothing"
          }}`,
        );
      }

      /*
       * The destructive half. A toggle sends the change, not the list, so a member whose screen
       * resolved the list wrongly cannot write that over a real exclusion. Removing one leaves
       * the other standing — under the old whole-array PATCH, a member seeding from an empty read
       * would have left nothing.
       */
      const dropped = await asInvitee("PATCH", "/api/household", { removeAllergen: "peanut" });
      record(
        "a member removing one allergen removes one, not the list",
        dropped.status === 200 && (dropped.body?.avoidedAllergens ?? []).join() === "wheat",
        `HTTP ${dropped.status} — ${JSON.stringify(dropped.body?.avoidedAllergens ?? null)}, wanted ["wheat"]`,
      );

      const added = await asInvitee("PATCH", "/api/household", { addAllergen: "sesame" });
      record(
        "and adding one adds to what is stored rather than replacing it",
        added.status === 200 && (added.body?.avoidedAllergens ?? []).join() === "sesame,wheat",
        `HTTP ${added.status} — ${JSON.stringify(added.body?.avoidedAllergens ?? null)}, wanted ["sesame","wheat"]`,
      );

      /* and the owner's view agrees, because there is one stored list and both read it */
      /*
       * And the owner's value is unchanged by the member's read — the third assertion the brief
       * asked for. One stored list, both members reading it, so "unchanged" here means the
       * member's screen did not write anything just by being looked at.
       */
      const ownerAfter = await call("PATCH", "/api/household", { body: { addAllergen: "peanut" } });
      record(
        "the owner's list still holds what the member left, plus the owner's own change",
        ownerAfter.status === 200 && (ownerAfter.body?.avoidedAllergens ?? []).join() === "peanut,sesame,wheat",
        `HTTP ${ownerAfter.status} — ${JSON.stringify(ownerAfter.body?.avoidedAllergens ?? null)}, wanted ["peanut","sesame","wheat"]`,
      );
    }
  } else {
    skip("two members of one household: shared settings shared, personal settings their own", "no invited account");
  }

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
    /*
     * EVERY screen a person can reach, rendered as a real session.
     *
     * ---------------------------------------------------------------------------
     * Why all of them and not the three that seemed to matter
     * ---------------------------------------------------------------------------
     *
     * The planner was 500ing for every household while a hundred checks passed, because smoke
     * called ROUTES and a server-rendered page is not a route. The obvious fix was to add the
     * screens that looked important. Three reasons not to stop there:
     *
     * **The cost objection does not survive a measurement.** A page load is about a second.
     * Twelve screens is twelve seconds on a run that already takes minutes.
     *
     * **"The marginal ones rarely change" is the wrong criterion.** A quiet screen is still
     * changed by every cross-cutting edit, and those are the ones that break it: the timezone
     * change touched four screens, the `finally` sweep eleven files, `TELLING_DIMENSIONS` two.
     * Risk lives in shared code, and shared code hits the screens nobody is thinking about
     * hardest.
     *
     * **Choosing three requires predicting which will break.** I had just demonstrated I cannot
     * — I would have ranked the planner as well covered.
     *
     * So the static routes are **discovered from the app directory**, not listed, because a
     * thirteenth screen that nobody adds here is the whole failure again. Dynamic routes are
     * named explicitly, since they need real ids.
     */
    const pageDir = new URL("../apps/web/app/", import.meta.url);
    const discover = async (dir, prefix = "") => {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(new URL(dir), { withFileTypes: true });
      const here = entries.some((e) => e.name === "page.tsx") ? [prefix || "/"] : [];
      const below = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // dynamic segments and route groups are handled by name below, not discovered
        if (entry.name.startsWith("[") || entry.name.startsWith("(") || entry.name === "api") continue;
        below.push(...(await discover(new URL(`${entry.name}/`, dir), `${prefix}/${entry.name}`)));
      }
      return [...here, ...below];
    };

    /*
     * A marker is content only a working render produces. Where there is no honest one — a
     * redirect, or a screen whose content depends on state this run does not create — the
     * check is alive-and-no-exception, which is still the assertion that would have caught the
     * planner. Coverage is printed rather than assumed.
     */
    const MARKERS = {
      // a screen may assert more than one, so a block added to it is covered rather than
      // riding on a marker that was already passing
      "/planner": [
        "Waiting for a day",
        /*
         * §67's footnote, asserted PRESENT rather than asserted non-empty.
         *
         * It is allowed to say nothing and on most weeks it does — base overlap fires on about
         * one plan entry in six. What must never happen is the block vanishing, because an absent
         * footnote is indistinguishable from one that failed to load. So the heading is the
         * marker and its contents are not: a check demanding a suggestion would fail on a quiet
         * week, and a check that fails routinely is one people learn to ignore.
         */
        "Alongside this week",
        // the Harvest week (§4.4): the summary chips, the day rows, and the dashed empty day
        "dinners",
        "h-day-row",
        "+ Add dinner",
        "h-week",
        /*
         * Item 3: the row at rest. `aria-expanded="false"` asserts the disclosure exists AND is
         * closed — which is the whole fix, since a panel rendered open on every row is the
         * overcrowding it was built to remove. And the cooked mark, because it is the one control
         * that must survive at rest: moving it behind a tap cost two ratings against twenty-eight
         * planned dinners the last time.
         */
        'aria-expanded="false"',
        "h-cooked-mark",
      ],
      /*
       * The Harvest restyle, asserted rather than assumed (§4.1).
       *
       * "Tonight" was already here; the other two are the header question that replaced the
       * household name, and the docked tab bar that replaced five header links. A restyle that
       * renders the old markup is a restyle that did not happen, and nothing else would notice.
       */
      /*
       * "Tonight" was a marker here and has gone with the banner it asserted (§82) — the question
       * it answered now has its own screen, and a marker for a removed block would have failed
       * loudly, which is the right direction for a deletion.
       */
      /*
       * §85. The question appears only for a household that has never answered AND has more than
       * seven recipes, so neither is asserted here — a smoke household has three. What IS
       * asserted is below, against a real layout write.
       */
      "/recipes": ["for dinner?", 'aria-label="Main"'],
      // the setting itself, which is on /household for every household
      "/household": ["How do you usually decide what to cook?", "We cook the same things"],
      /*
       * Today (§82). The leaderboard's own chips are NOT asserted: a household with no ratings
       * has none, and that is a correct screen rather than a broken one — the same reasoning as
       * the alongside footnote. What must always be there is the heading, the slot invitations
       * and the honesty line that keeps the counts from reading as a score.
       */
      /*
       * "Nothing is averaged" was a marker here and is **state-dependent**: it lives inside the
       * leaderboard, and a household with no ratings renders the "nobody has rated anything yet"
       * sentence instead. A fresh smoke household has none, so the check failed against a correct
       * screen — the same mistake the alongside footnote's marker was written to avoid, repeated
       * one screen later. The heading is in both states; the chips are in neither reliably.
       */
      /*
       * Today v2. The four slot tabs are always present, so they are the stable markers; the
       * leaderboard's heading now carries the slot's plural ("Dinners everyone likes"), so the
       * old "What everyone likes" marker is gone with the thing it asserted.
       *
       * The v1 markers "+ Add breakfast" / "+ Add dinner" went with the dashed slot buttons the
       * tabs replaced — a marker for a removed control fails loudly, which is the right direction
       * for a deletion.
       */
      /*
       * "Household ·" was a marker here and is **time-of-day dependent**: it lives in the
       * leaderboard, and the tab the hour opens may be a course this household owns none of — in
       * which case the quiet branch renders instead and the marker is correctly absent. It passed
       * for a day and failed when the clock moved, which is the third state-dependent marker in
       * this file and the same mistake the alongside footnote's marker was written to avoid.
       *
       * The tabs are the stable thing: they render whatever the hour, whatever the data.
       */
      "/today": ["Today", "Bkfst", "Lunch", "Dinner", "Snack", "h-segmented"],
      /*
       * The Harvest shopping list (§4.5). The segmented control and the aisle rows are asserted;
       * the consolidation chips are not, because a week with no overlapping ingredient has none
       * and that is a correct list rather than a broken screen — the same reasoning as the
       * alongside footnote one entry up.
       */
      "/shopping": ["By aisle", "By meal", "h-buy", "in the trolley"],
      // two markers, so the allergen control is covered rather than riding on one that already
      // passed — the §71 setting is the whole reason this screen matters now
      "/household": ["Where you cook", "What you avoid"],
      "/recipes/new": "Add a recipe",
      "/recipes/import": "One link",
      /*
       * No marker for `/sign-in` or `/`: a signed-in session is redirected away from both, so
       * there is no content of theirs to assert. Asserting one failed, correctly — the page a
       * session is bounced to is not the page that was asked for. They still get the
       * alive-and-no-exception pair, which is the check that would have caught the planner.
       */
    };

    const screens = [
      ...(await discover(pageDir)).map((path) => [
        path,
        path === "/planner" ? `/planner?week=${weekStart}` : path,
        MARKERS[path] ?? null,
      ]),
      // dynamic routes, with ids this run actually has
      /*
       * A real marker now, where there was none. A recipe this run just created has no stored
       * partition, so a working render must offer to work one out — which is the assertion that
       * the *control* is reachable, not merely that the page returns 200. The display of parts
       * had been on this page since §60 with nothing on it able to produce them.
       */
      [
        "/recipes/[id]",
        `/recipes/${recipeId}`,
        // the parts control, and the preference control that sits with the ratings. A recipe this
        // run just created has no partition and no stated preferences, so a working render must
        // offer both — which is the assertion that each is REACHABLE, not that the page is 200.
        [
          "Parts of this recipe", "Was it something in particular?",
          // the Harvest restyle (§4.2): the overlapping sheet, and the docked actions that
          // replaced a header row of five buttons
          "h-sheet", "h-docked",
        ],
      ],
      ["/recipes/[id]/edit", `/recipes/${recipeId}/edit`, null],
      ["/recipes/blend?from=", `/recipes/blend?from=${recipeId}`, null],
      // a token this run cannot hold: the invitation response carries none, on purpose. An
      // invalid link must render a refusal, not an exception.
      ["/invite/[token]", "/invite/not-a-real-token", null],
    ];

    let unmarked = 0;
    for (const [name, path, marker] of screens) {
      const page = await call("GET", path);
      const body = typeof page.body === "string" ? page.body : JSON.stringify(page.body);
      /*
       * 200, not `alive()`. A **404 is not a rendered page**, and `alive` deliberately accepts
       * anything under 500 because it is about "did a handler run" — so a missing route reported
       * `ok … renders — HTTP 404` while every marker under it failed. The verdict contradicted
       * its own children, which is the self-contradicting-detail problem one level up: the
       * summary line said yes and the detail said 404.
       *
       * Found by deploying a new screen and running the suite before the deploy landed. A 3xx is
       * not a rendered page either: this list is screens a signed-in person can reach, and a
       * redirect means they were sent somewhere else.
       */
      record(`${name} renders`, page.status === 200, `HTTP ${page.status}`);
      record(
        `and ${name} has no server-side exception`,
        !/Application error|server-side exception|Functions cannot be passed|Digest:/i.test(body),
        "Next's error page, and the RSC function refusal by name",
      );
      if (marker) {
        for (const needle of Array.isArray(marker) ? marker : [marker]) {
          /*
           * The detail must say whether the needle was FOUND, not whether the page answered.
           *
           * It printed "found" for any 200, so a failing marker check read `FAIL … — found`,
           * which is self-contradictory and sent me looking at the page instead of at the needle.
           * A detail that contradicts its own verdict is worse than an empty one.
           */
          const present = body.includes(needle) || visible(body).includes(needle);
          record(
            `and ${name} renders ${JSON.stringify(needle)}`,
            page.status === 200 && present,
            page.status !== 200 ? `HTTP ${page.status}` : present ? "found" : "NOT in the page",
          );
        }
      } else {
        unmarked += 1;
      }
    }
    console.log(
      `  ${screens.length} screens loaded as a session; ${unmarked} checked for life and exceptions only`,
    );

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
    /*
     * A metric household reads one system, everywhere.
     *
     * The bug this guards: `consolidate` rendered the need and the packages in the household's
     * system and the per-recipe usage line as written, so a metric household read "600 ml pot"
     * and "500 g" beside "Tuesday takes 1 lb" — one page, two systems, in the document that is
     * read standing in a shop. Checked end to end because the setting, the seam and the
     * formatter each work in isolation and the fault was in how they met.
     */
    const toMetric = await call("PATCH", "/api/household", { body: { measurementSystem: "metric" } });
    record("a household can choose metric", toMetric.status === 200
      && toMetric.body?.measurementSystem === "metric", `HTTP ${toMetric.status}`);

    const metricList = await call("GET", `/shopping?week=${weekStart}`);
    const metricHtml = typeof metricList.body === "string" ? metricList.body : JSON.stringify(metricList.body);
    // the list's own quantities, not the surrounding prose — strip tags first
    const quantities = metricHtml.replace(/<[^>]+>/g, " ");
    record("and the shopping list renders for it", alive(metricList), `HTTP ${metricList.status}`);
    record(
      "and reads in one system throughout",
      /\b\d[\d.,½¼¾⅓⅔⅛]*\s?(g|kg|ml|l)\b/.test(quantities)
        && !/\b\d[\d.,½¼¾⅓⅔⅛]*\s?(lb|oz|cup|cups|qt|gal|pint)\b/.test(quantities),
      /\b\d[\d.,½¼¾⅓⅔⅛]*\s?(lb|oz|cup|cups|qt|gal|pint)\b/.exec(quantities)?.[0]
        ? `imperial on a metric page: ${/\b\d[\d.,½¼¾⅓⅔⅛]*\s?(lb|oz|cup|cups|qt|gal|pint)\b/.exec(quantities)[0]}`
        : "",
    );

    /*
     * These checks get their own recipe, and the reason is worth keeping.
     *
     * The first version used the shared `recipeId` — and the edit test above PATCHes that recipe
     * to `ingredients: "2 cups flour"`, so by the time these ran the peanut and the lemons were
     * gone. Both "reproductions" were measuring nothing: a probe that could not have succeeded.
     * The failures looked like the reported bugs and were artefacts of the harness.
     */
    const subject = await call("POST", "/api/recipes", {
      body: {
        title: "Smoke Allergen Subject",
        servings: "2", timeMinutes: "10", sourceName: "", sourceUrl: "",
        ingredients: "2 tbsp peanut butter\n150 g rice noodles\n3 lemons",
        steps: "Stir.",
      },
    });
    const subjectId = subject.body?.recipe?.id ?? subject.body?.id ?? null;
    record("a recipe for the allergen checks exists", subject.status === 200 && Boolean(subjectId),
      `HTTP ${subject.status}`);

    /*
     * The two §71 writes, exercised rather than assumed.
     *
     * Both controls render — the screen markers above assert that — and a control that renders is
     * not a control that works. "An endpoint answering is not a feature" has its mirror image:
     * a feature that is reachable still has to land in the database.
     */
    const avoid = await call("PATCH", "/api/household", { body: { avoidedAllergens: ["peanut", "sesame"] } });
    record(
      "a household can say what it avoids",
      avoid.status === 200 && Array.isArray(avoid.body?.avoidedAllergens)
        && avoid.body.avoidedAllergens.join() === "peanut,sesame",
      `HTTP ${avoid.status} — ${JSON.stringify(avoid.body?.avoidedAllergens ?? null)}`,
    );

    // the CHECK is the authority, not the route: an unknown allergen must be refused, and
    // refused with a status the UI can act on rather than a 500
    const badAllergen = await call("PATCH", "/api/household", { body: { avoidedAllergens: ["unobtainium"] } });
    record(
      "and an allergen that is not one of the nine is refused, not stored",
      badAllergen.status === 400,
      `HTTP ${badAllergen.status}`,
    );

    const cleared = await call("PATCH", "/api/household", { body: { avoidedAllergens: [] } });
    record("and can clear it again", cleared.status === 200
      && Array.isArray(cleared.body?.avoidedAllergens) && cleared.body.avoidedAllergens.length === 0,
      `HTTP ${cleared.status}`);

    if (adultMemberId) {
      const disliked = await call("POST", "/api/preferences", {
        body: { familyMemberId: adultMemberId, stance: "dislike", subjectKind: "ingredient", subject: "mushroom" },
      });
      record("a preference can be stated", disliked.status === 200 && Boolean(disliked.body?.id),
        `HTTP ${disliked.status}`);

      // stating the opposite is an UPDATE, not a second row: `stance` is outside the unique
      // index precisely so a like and a dislike cannot coexist for anything to resolve
      const changed = await call("POST", "/api/preferences", {
        body: { familyMemberId: adultMemberId, stance: "like", subjectKind: "ingredient", subject: "mushroom" },
      });
      record("and changing your mind replaces it rather than contradicting it",
        changed.status === 200 && changed.body?.changed === true, `HTTP ${changed.status}`);

      /*
       * Two members disagreeing is the NORMAL case — it is the whole reason preferences are per
       * member — and the row has to express it. Reported live: liking rice noodles for one
       * person and disliking them for another made the subject disappear, so the second
       * statement could not be made at all.
       */
      const second = await call("POST", "/api/members", {
        body: { displayName: "Smoke Disagreer" },
      });
      const secondId = second.body?.member?.id ?? null;
      if (secondId) {
        const theirs = await call("POST", "/api/preferences", {
          body: { familyMemberId: secondId, stance: "dislike", subjectKind: "ingredient", subject: "rice noodles" },
        });
        const mineToo = await call("POST", "/api/preferences", {
          body: { familyMemberId: adultMemberId, stance: "like", subjectKind: "ingredient", subject: "rice noodles" },
        });
        record(
          "two members can disagree about the same subject",
          theirs.status === 200 && mineToo.status === 200,
          `dislike HTTP ${theirs.status}, like HTTP ${mineToo.status}`,
        );

        const withBoth = await call("GET", `/recipes/${subjectId}`);
        const bothHtml = typeof withBoth.body === "string" ? withBoth.body : JSON.stringify(withBoth.body);
        record(
          "and the recipe page names both, rather than losing one",
          withBoth.status === 200
            && /Smoke Disagreer/.test(bothHtml)
            && (bothHtml.match(/rice noodles/g) ?? []).length >= 2,
          withBoth.status === 200
            ? `${(bothHtml.match(/rice noodles/g) ?? []).length} mentions; options: ${JSON.stringify((bothHtml.match(/value="(?:ingredient|cuisine|dish_form|course):[^"]*"/g) ?? []).slice(0, 8))}`
            : `HTTP ${withBoth.status}`,
        );

        // the subject must STILL be offered: a vanished option is a dead end for anybody who
        // has not spoken yet
        record(
          "and the subject is still offered, so a third member could speak",
          withBoth.status === 200 && /value="ingredient:rice noodles"/.test(bothHtml),
          /value="ingredient:rice noodles"/.test(bothHtml) ? "still in the list" : "the option is gone",
        );
      } else {
        skip("two members can disagree about the same subject", "a second member could not be added");
        skip("and the recipe page names both, rather than losing one", "no second member");
        skip("and the subject is still offered, so a third member could speak", "no second member");
      }

      if (disliked.body?.id) {
        const withdrawn = await call("DELETE", `/api/preferences?id=${disliked.body.id}`);
        record("and it can be withdrawn", withdrawn.status === 200, `HTTP ${withdrawn.status}`);
      } else {
        skip("and it can be withdrawn", "nothing was stated, so there is nothing to withdraw");
      }
    } else {
      skip("a preference can be stated", "the roster block did not run, so no live member id is known");
      skip("and changing your mind replaces it rather than contradicting it", "no live member");
      skip("and it can be withdrawn", "no live member");
    }

    /*
     * The filter, not the setting.
     *
     * A marker proving the control renders does not prove the thing it controls, and these two
     * had drifted apart: the matcher was measured against 82 recipes, the setting saved and read
     * back, and nothing joined them. For an allergy that is worse than an unbuilt feature — it
     * implies a protection that does not exist, and §71's whole honesty argument assumed the
     * filter ran.
     */

    const setPeanut = await call("PATCH", "/api/household", { body: { avoidedAllergens: ["peanut"] } });
    record("avoiding peanut saves", setPeanut.status === 200, `HTTP ${setPeanut.status}`);

    /*
     * ---------------------------------------------------------------------------
     * An "absent" assertion needs a positive control in the same response
     * ---------------------------------------------------------------------------
     *
     * This read `GET /recipes` and asserted the subject's title was not in the HTML. The chapter
     * tree (§86) broke it **silently and in the dangerous direction**: this household is on
     * `browse` by the time it runs, and a contents page lists *chapters*, so no recipe title is
     * there at all. The check went on passing and would have passed with the allergen filter
     * ripped out entirely — §54a's proxy that rots without failing, caused by a screen changing
     * underneath it rather than by anything wrong with the filter.
     *
     * Two fixes, and the second is the general one. The list is read through a **search**, which
     * suspends the layout on every one of the five, so the response is a flat list whatever the
     * household has chosen. And a **control recipe** is asserted present in the same response: if
     * "Smoke Test Pie" is not there either then the list is simply empty and "the subject is
     * absent" has measured nothing.
     *
     * The rule worth keeping: **an assertion that something is missing is worthless without
     * evidence that something else is present.** Absence and emptiness are indistinguishable.
     */
    const hiddenList = await call("GET", "/recipes?q=smoke");
    const hiddenHtml = typeof hiddenList.body === "string" ? hiddenList.body : JSON.stringify(hiddenList.body);
    const controlPresent = hiddenHtml.includes("Smoke Test Pie");
    record(
      "a recipe naming an avoided allergen is absent from the recipe list",
      hiddenList.status === 200 && controlPresent && !hiddenHtml.includes("Smoke Allergen Subject"),
      hiddenList.status !== 200
        ? `HTTP ${hiddenList.status}`
        : !controlPresent
          ? "NOT MEASURED: the control recipe is absent too, so the list is empty"
          : hiddenHtml.includes("Smoke Allergen Subject")
            ? "still listed — the filter is not wired"
            : "hidden, with the control still listed",
    );

    /*
     * And absent from the **chapters**, which is a door the flat list never had.
     *
     * The brief requires exclusions to apply to every chapter with the hidden count stated. The
     * tree reads through the same `searchRecipes` call, so this is checking the join rather than
     * the matcher — and a join is where two pieces of correct work meet.
     */
    const chapterLeaf = await call("GET", "/recipes/c/unsorted");
    /*
     * `visible()`, and the first version of this check did not use it — which is the documented
     * trap, committed again in the probe rather than in the page. `{count} hidden:` is a static
     * string beside an interpolated one, so React's SSR separates them with an empty comment and
     * the served HTML reads `1<!-- --> hidden:`. The regex found nothing, the screen was right,
     * and the failure was indistinguishable from "the chapter does not say so".
     */
    const leafHtml = visible(typeof chapterLeaf.body === "string" ? chapterLeaf.body : JSON.stringify(chapterLeaf.body));
    record(
      "and absent from its chapter, with the hidden count stated rather than silent",
      chapterLeaf.status === 200 && !leafHtml.includes("Smoke Allergen Subject") && /\d+ hidden:/.test(leafHtml),
      chapterLeaf.status !== 200
        ? `HTTP ${chapterLeaf.status}`
        : leafHtml.includes("Smoke Allergen Subject")
          ? "the chapter does not filter"
          : /\d+ hidden:/.test(leafHtml)
            ? "hidden, and the chapter says how many"
            : "hidden, but the chapter does not say so",
    );

    const hiddenSearch = await call("GET", "/recipes?q=allergen");
    const searchHtml = typeof hiddenSearch.body === "string" ? hiddenSearch.body : JSON.stringify(hiddenSearch.body);
    record(
      "and absent from search, which is a second door onto the same list",
      hiddenSearch.status === 200 && !searchHtml.includes("Smoke Allergen Subject"),
      hiddenSearch.status === 200
        ? searchHtml.includes("Smoke Allergen Subject") ? "still found — search does not filter" : "hidden"
        : `HTTP ${hiddenSearch.status}`,
    );

    // opened directly it must still render, with the reason named: hiding a recipe somebody has
    // the link to would be a 404 for a recipe that exists
    const direct = await call("GET", `/recipes/${subjectId}`);
    const directHtml = typeof direct.body === "string" ? direct.body : JSON.stringify(direct.body);
    record(
      "but opening it directly says why, rather than refusing",
      direct.status === 200 && /Contains peanut:/.test(directHtml),
      direct.status === 200
        ? /Contains peanut:/.test(directHtml) ? "the reason is named" : "no warning rendered"
        : `HTTP ${direct.status}`,
    );

    const clearPeanut = await call("PATCH", "/api/household", { body: { avoidedAllergens: [] } });
    // searched, for the same reason as above: a contents page has no titles to find it in
    const restored = await call("GET", "/recipes?q=allergen");
    const restoredHtml = typeof restored.body === "string" ? restored.body : JSON.stringify(restored.body);
    record(
      "and clearing it brings the recipe back",
      clearPeanut.status === 200 && restoredHtml.includes("Smoke Allergen Subject"),
      clearPeanut.status !== 200 ? `HTTP ${clearPeanut.status}` : restoredHtml.includes("Smoke Allergen Subject") ? "back" : "still hidden",
    );

    const backToUs = await call("PATCH", "/api/household", { body: { measurementSystem: "us" } });
    record("and can change back", backToUs.status === 200
      && backToUs.body?.measurementSystem === "us", `HTTP ${backToUs.status}`);

    const refused = await call("PATCH", "/api/household", { body: { measurementSystem: "imperialish" } });
    record("and refuses a system that is not one", refused.status === 400, `HTTP ${refused.status}`);

    /*
     * A pasted caption, end to end (decisions §48).
     *
     * The path tier 2 exists for: no markup to read, so tiers 0 and 1 have nothing to do. A 500
     * here means no handler ran; a 422 means the model was asked and found nothing, which is an
     * answer. A deployment with no model configured answers 422 too — checked separately below so
     * "not configured" and "answered badly" stay distinguishable.
     */
    const caption = [
      "Creamy Potato & Sausage Soup",
      "1 lb Italian sausage",
      "6 cups chicken broth",
      "1 cup heavy cream",
      "3 cloves garlic, minced",
    ].join("\n");
    const pasted = await call("POST", "/api/import", { body: { text: caption } });
    record("a pasted caption imports", alive(pasted), `HTTP ${pasted.status}`);
    if (pasted.status === 200) {
      const lines = pasted.body?.draft?.ingredients ?? "";
      record(
        "and the model found the ingredients",
        typeof lines === "string" && /sausage/i.test(lines) && /broth/i.test(lines),
        typeof lines === "string" ? lines.slice(0, 60) : "no draft",
      );
      record(
        "and core parsed the amounts rather than the model",
        typeof lines === "string" && /\b1 lb\b/i.test(lines) && /\b6 cups?\b/i.test(lines),
        "verbatim lines, parsed by core (§48)",
      );
    } else {
      record(
        "a pasted caption is refused for a stated reason, not a crash",
        pasted.status === 422 || pasted.status === 429,
        `HTTP ${pasted.status} — ${String(pasted.body?.error ?? "").slice(0, 70)}`,
      );
      /*
       * The two assertions above are NOT CHECKED, not absent.
       *
       * A refusal here is legitimate — the model declines on some captions, and this run saw a
       * 422 where the previous one saw a 200. But the dependent checks then simply *vanished*,
       * so the run printed "133 passed" where the last printed 134, with nothing saying two were
       * not measured. That is this file's own header arriving in this file: the only thing
       * distinguishing a complete run from an incomplete one was remembering the old number.
       */
      skip("and the model found the ingredients", "the caption import was refused, so there is no draft to read");
      skip("and core parsed the amounts rather than the model", "the caption import was refused, so there is no draft to read");
    }

    record(
      "the database has every column the app selects",
      contract.ok,
      contract.ok ? "" : `PostgREST refused the app's select: ${await contract.text().then((t) => t.slice(0, 120))}`,
    );
  }

  // ---------------------------------------------------------------------------
  /*
   * Blending (§60 step 4).
   *
   * A smoke check that calls an endpoint proves the endpoint and nothing else — two of the last
   * three things built had no way in from the product while their checks were green. So this
   * exercises the whole write: two real recipes, a blend of parts of both, then reads back the
   * lineage and the composed lines to see that they are what was asked for.
   *
   * The reachability of the screen is a separate guard (`check-routes-reachable.mjs`), which is
   * mutation-tested. Between them: the route works and the screen linking to it exists.
   */
  // ---------------------------------------------------------------------------
  /*
   * Tonight, and cooking it.
   *
   * The whole journey in three calls: put a recipe on today, record that it was cooked, and see
   * the count follow. That last assertion is the one that matters — `times_made` is derived by a
   * trigger, so it is the only proof the event reached the number four screens read.
   */
  console.log("\ntonight");
  if (recipeId) {
    const today = new Date().toISOString().slice(0, 10);
    const onTonight = await call("POST", "/api/plan-entries", { body: { recipeId, date: today } });
    record(
      "put a recipe on tonight in one call",
      onTonight.status === 200 || onTonight.status === 409,
      `HTTP ${onTonight.status}`,
    );

    const mine = await rest("GET", `/plan_entries?family_id=eq.${familyId}&date=eq.${today}&select=id,cooked_at&deleted_at=is.null`);
    const entryForTonight = mine?.[0]?.id;
    if (entryForTonight) {
      record("and it is not yet cooked", mine[0].cooked_at === null, `cooked_at ${mine[0].cooked_at}`);

      const cooked = await call("PATCH", `/api/plan-entries/${entryForTonight}`, { body: { cooked: true } });
      record("record that it was cooked", cooked.status === 200, `HTTP ${cooked.status}`);

      const after = await rest("GET", `/recipes?id=eq.${recipeId}&select=times_made`);
      record(
        "and the count a household reads follows from the meal",
        Number(after?.[0]?.times_made) >= 1,
        `times_made ${after?.[0]?.times_made}`,
      );

      const undone = await call("PATCH", `/api/plan-entries/${entryForTonight}`, { body: { cooked: false } });
      const back = await rest("GET", `/recipes?id=eq.${recipeId}&select=times_made`);
      record(
        "unmarking it puts the count back",
        undone.status === 200 && Number(back?.[0]?.times_made) === 0,
        `HTTP ${undone.status}, times_made ${back?.[0]?.times_made}`,
      );

      const noWrite = await fetch(`${SUPABASE}/rest/v1/recipes?id=eq.${recipeId}`, {
        method: "PATCH",
        headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ times_made: 99 }),
      });
      record(
        "and a household cannot write the count itself",
        noWrite.status >= 400,
        `HTTP ${noWrite.status}`,
      );
    } else {
      skip("cooking a meal", "no plan entry for today was readable");
    }
  }

  console.log("\nblending");
  if (recipeId) {
    const second = await call("POST", "/api/recipes", {
      body: {
        title: "Smoke Test Sauce",
        servings: "2",
        timeMinutes: "10",
        sourceName: "",
        sourceUrl: "",
        ingredients: "200 ml double cream\n1 tbsp mustard",
        steps: "Reduce.",
      },
    });
    const sauceId = second.body?.id ?? null;
    if (sauceId) madeRecipes.push(sauceId);
    record("a second recipe to blend with", second.status === 200 && Boolean(sauceId), `HTTP ${second.status}`);

    /*
     * The split action — three model calls behind one request.
     *
     * 200 and 503 are both correct answers: the reader found parts, or the reader was busy and
     * said so. **500 is not**, because it means no handler ran — and this route has a duration
     * cap it must finish inside, which is the specific thing that would fail here and nowhere
     * else. Checking the shape rather than the outcome is the point: the model's answer is not
     * this file's business, but "did the function survive its own timeout" is.
     */
    if (sauceId) {
      const started = Date.now();
      const split = await call("POST", `/api/recipes/${sauceId}`, { body: { split: true } });
      const took = Math.round((Date.now() - started) / 1000);
      record(
        "splitting a recipe answers rather than dying inside its timeout",
        split.status === 200 || split.status === 503,
        `HTTP ${split.status} in ${took}s${split.status === 200 ? `, ${split.body?.parts} part(s) from ${split.body?.readings} reading(s)` : ""}`,
      );
    }

    if (sauceId) {
      const blended = await call("POST", "/api/recipes", {
        body: {
          blend: {
            title: "Smoke Test Blend",
            parts: [
              // the client sends line numbers, never content — the route reads the lines itself
              // the pie was edited down to one line earlier in this run, so index 0 is all it
              // has — the first version of this check asked for index 2 and got a correct 409
              { sourceRecipeId: recipeId, componentName: "the filling", role: "sweet",
                taken: "component", lineIndexes: [0], adjusted: true },
              { sourceRecipeId: sauceId, componentName: "the sauce", role: "sauce",
                taken: "component", lineIndexes: [0, 1], adjusted: false },
            ],
          },
        },
      });
      const blendId = blended.body?.id ?? null;
      if (blendId) madeRecipes.push(blendId);
      record("blend parts of two recipes", blended.status === 200 && Boolean(blendId), `HTTP ${blended.status}`);

      if (blendId) {
        const lines = await rest("GET", `/recipe_ingredients?recipe_id=eq.${blendId}&select=position,item_text,section&order=position`);
        record(
          "and it took the lines that were chosen, not the whole recipe",
          Array.isArray(lines) && lines.length === 3,
          `${Array.isArray(lines) ? lines.length : "no"} lines`,
        );
        record(
          "and each line knows which part it came from",
          Array.isArray(lines) && lines[0]?.section === "the filling" && lines[2]?.section === "the sauce",
          Array.isArray(lines) ? lines.map((l) => l.section).join(", ") : "none",
        );

        // the stale-selection guard, which found a real mistake in this very check
        const stale = await call("POST", "/api/recipes", {
          body: {
            blend: {
              title: "Blend of a line that is not there",
              parts: [
                { sourceRecipeId: recipeId, componentName: "gone", role: null, taken: "component", lineIndexes: [99], adjusted: false },
                { sourceRecipeId: sauceId, componentName: "the sauce", role: null, taken: "component", lineIndexes: [0], adjusted: false },
              ],
            },
          },
        });
        if (stale.body?.id) madeRecipes.push(stale.body.id);
        record(
          "refuses a line that is no longer in its recipe",
          stale.status === 409,
          `HTTP ${stale.status}`,
        );

        const lineage = await rest("GET", `/recipe_derivations?blend_recipe_id=eq.${blendId}&select=component_name,source_title,ingredients_from,ingredients_to,adjusted&order=position`);
        record(
          "and the lineage records where each part came from",
          // "Pie II": the recipe is renamed by the edit earlier in this run, and the lineage
          // snapshots the title as it was at the cut — which is the point of storing it
          Array.isArray(lineage) && lineage.length === 2 && lineage[0]?.source_title === "Smoke Test Pie II",
          Array.isArray(lineage) ? lineage.map((l) => `${l.component_name}<-${l.source_title}`).join(" ") : "none",
        );
        record(
          "and remembers that a person moved the boundaries",
          Array.isArray(lineage) && lineage[0]?.adjusted === true && lineage[1]?.adjusted === false,
          Array.isArray(lineage) ? `${lineage[0]?.adjusted}, ${lineage[1]?.adjusted}` : "none",
        );

        const asBlend = await rest("GET", `/recipes?id=eq.${blendId}&select=servings,derived_at,visibility`);
        record(
          "a blend states no servings, because its parts disagree",
          asBlend?.[0]?.servings === null && asBlend?.[0]?.derived_at !== null,
          `servings ${asBlend?.[0]?.servings}, derived ${Boolean(asBlend?.[0]?.derived_at)}`,
        );

        /*
         * The boundary, attempted against production rather than assumed from the migration.
         *
         * A raw fetch rather than `rest`, which treats any 4xx as a service-role refusal and
         * aborts the run — right for every other call here and wrong for this one, where the
         * refusal IS the result. A CHECK violation (23514) is what success looks like.
         */
        const publish = await fetch(`${SUPABASE}/rest/v1/recipes?id=eq.${blendId}`, {
          method: "PATCH", headers: svc, body: JSON.stringify({ visibility: "public" }),
        });
        const refusal = await publish.json().catch(() => ({}));
        const stillPrivate = await rest("GET", `/recipes?id=eq.${blendId}&select=visibility`);
        record(
          "and can never be published (§60), refused by the database itself",
          publish.status === 400 && refusal?.code === "23514" && stillPrivate?.[0]?.visibility === "private",
          `HTTP ${publish.status} ${refusal?.code ?? ""}, visibility ${stillPrivate?.[0]?.visibility}`,
        );

        const onBlend = await call("POST", "/api/recipes", {
          body: {
            blend: {
              title: "Blend of a blend",
              parts: [
                { sourceRecipeId: blendId, componentName: "x", role: null, taken: "whole", lineIndexes: [0], adjusted: false },
                { sourceRecipeId: sauceId, componentName: "y", role: null, taken: "whole", lineIndexes: [0], adjusted: false },
              ],
            },
          },
        });
        if (onBlend.body?.id) madeRecipes.push(onBlend.body.id);
        record(
          "and refuses to be blended again",
          onBlend.status === 400,
          `HTTP ${onBlend.status}`,
        );
      }
    }
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
  if (error?.measurement) {
    console.error(`\nCOULD NOT MEASURE: ${String(error.message).slice(0, 200)}`);
    console.error("  A service-role query was refused, so what follows would be guesswork.");
    process.exit(CANNOT_MEASURE);
  }
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
  const note = skipped.length ? `, ${skipped.length} NOT CHECKED` : "";
  console.log(`SMOKE: ${results.length} checks passed${note} against ${base}`);
  for (const s of skipped) console.log(`  not checked: ${s.name} — ${s.why}`);
  process.exit(PASSED);
}
console.log(`SMOKE: ${failed.length} of ${results.length} FAILED against ${base}${skipped.length ? `, ${skipped.length} NOT CHECKED` : ""}`);
for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ""}`);
for (const s of skipped) console.log(`  not checked: ${s.name} — ${s.why}`);
process.exit(FAILED);
