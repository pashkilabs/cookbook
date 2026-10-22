#!/usr/bin/env node
/**
 * Render a screen at phone width and **measure** it, because a stylesheet cannot show you this.
 *
 * The fault that bought this tool: the rotation's cards were the Harvest list card — a
 * `96px 1fr` grid built for a 350px full-width row — dropped into a two-column grid. In a 169px
 * column the title gets **17px**, so every recipe title rendered one character per line. Every
 * guard passed: `check-harvest-classes`, `check-contrast`, `check-palette-roles`, 110 pairs,
 * 248 tests, and smoke's markers were all present because the *text* was there. It is visible in
 * one screenshot and invisible in a stylesheet, which is the whole gap this closes.
 *
 * So it does two things, and the second is the one that will catch the next instance:
 *
 *   1. writes a PNG per screen per theme, for a person to look at
 *   2. asserts what only a layout engine knows — **no horizontal overflow**, and **no text box
 *      narrower than it needs**, which is the signature of the fault above
 *
 * Usage: node scripts/shot.mjs <baseUrl> [outDir]
 * Needs a signed-in session, so it provisions one the way smoke does.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:3000";
const outDir = process.argv[3] ?? ".shots";
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE || !ANON || !SERVICE) {
  console.error("COULD NOT MEASURE: NEXT_PUBLIC_SUPABASE_URL, _ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(2);
}

/** a phone, and the width every layout claim in this project is made about */
const WIDTH = 390;
const HEIGHT = 844;

const admin = (method, path, body) =>
  fetch(`${SUPABASE}/auth/v1/admin${path}`, {
    method,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  }).then((r) => r.json());

async function session() {
  const stamp = Date.now();
  const email = `shot-${stamp}@example.com`;
  const password = `Shot-${stamp}-Aa1!`;
  await admin("POST", "/users", { email, password, email_confirm: true });
  const token = await (
    await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  ).json();
  if (!token.access_token) throw new Error(`could not sign in: ${JSON.stringify(token).slice(0, 120)}`);
  return token;
}

const token = await session();
const ref = new URL(SUPABASE).host.split(".")[0];
const cookie = {
  name: `sb-${ref}-auth-token`,
  value: `base64-${Buffer.from(JSON.stringify(token)).toString("base64")}`,
  domain: new URL(base).hostname,
  path: "/",
};

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

/*
 * One household, with enough recipes to reach the layouts. Seven is the rule's own number, so a
 * shot of fewer would not exercise the cap the layouts exist to apply.
 */
/*
 * The cookie renders the page and the bearer token satisfies the routes — `lib/supabase-server.ts`
 * builds its client from cookies, and the API routes additionally want an Authorization header,
 * which is exactly the two-doors shape smoke documents. Sending one and not the other produced
 * `401 a bearer token is required` from a context that was rendering pages perfectly well.
 */
const AUTH = { Authorization: `Bearer ${token.access_token}` };

const page0 = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, extraHTTPHeaders: AUTH });
await page0.addCookies([cookie]);
const setup = await page0.newPage();
await setup.goto(`${base}/api/health`);

/*
 * Provisioning first, and this is not a detail.
 *
 * The first run of this script skipped it, so every page rendered "This account has no household
 * yet" — and all eight screens reported **ok**, because an empty page has no overflow and no
 * squeezed boxes. *A probe that could not have succeeded has measured nothing*, and it said ok
 * eight times. Only looking at the PNG found it, which is the argument for the PNG.
 *
 * So the household is created and then **asserted**, and a missing one is exit 2 rather than a
 * clean run over nothing.
 */
const provisioned = await setup.request.post(`${base}/api/household`, { data: {} });
const household = await provisioned.json().catch(() => ({}));
if (!household.familyId) {
  console.error(`COULD NOT MEASURE: no household was provisioned (HTTP ${provisioned.status()}) ${JSON.stringify(household).slice(0, 120)}`);
  process.exit(2);
}

/*
 * An operator grant, the same one smoke issues.
 *
 * Without it a fresh account on **production** is unentitled, every `/api/recipes` write is
 * refused by the meter, and the library is empty — which the recipe-count guard caught as
 * could-not-measure rather than reporting ok on twelve pictures of nothing. Local is permissive
 * enough not to need it, so this is the local-and-hosted-disagree shape arriving in a screenshot
 * tool: the thing that worked on a laptop refused in production, and the guard said so.
 */
await fetch(`${SUPABASE}/rest/v1/entitlements?on_conflict=family_id,app_key`, {
  method: "POST",
  headers: {
    apikey: SERVICE,
    authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  },
  body: JSON.stringify({
    family_id: household.familyId,
    app_key: "recipes",
    tier: "full",
    quota_json: { imports: { limit: 50, used: 0, resetsAt: null, periodDays: 30 } },
    valid_until: new Date(Date.now() + 86400000).toISOString(),
    grace_until: new Date(Date.now() + 2 * 86400000).toISOString(),
  }),
});

const made = [];
/*
 * A library shaped like the real one, because the tree's behaviour turns entirely on the data.
 *
 * Nine mains, so Mains is over the cap and **divides** — five mains would render the undivided
 * shape and tell us nothing about the screen this release is for. Two soups, one of them also a
 * main, so the deliberate `dish_form`/`course` overlap is on screen. No snacks at all, which is
 * what the real library has, so the shot shows eight tiles and not nine. Three with no course, so
 * the unsorted row has something behind it.
 *
 *   title, course, minutes, dish_form, principal_protein
 */
for (const [title, course, minutes, dishForm, protein] of [
  ["Grilled chilli and lemon chicken", "main", "90", null, "chicken"],
  ["Easy Fried Rice", "main", "30", null, null],
  ["Sausage and Rice Skillet", "main", "35", null, "pork"],
  ["Loaded potato soup", "main", "45", "soup", null],
  ["Pork Chops with Apples", "main", "40", null, "pork"],
  ["Weeknight Chicken Traybake", "main", "45", null, "chicken"],
  ["Slow Beef Ragu", "main", "180", null, "beef"],
  ["Pan-fried Salmon", "main", "20", null, "fish"],
  ["A recipe with a deliberately very long title indeed", "main", "", null, null],
  ["Tomato and basil soup", "starter", "30", "soup", null],
  ["Greek Salad", "side", "15", "salad", null],
  ["Coconut rice", "side", "25", null, null],
  ["Mango Salsa", "side", "20", null, null],
  ["Cinnamon Rolls", "breakfast", "180", null, null],
  ["Chocolate Mousse", "dessert", "25", null, null],
  ["Homemade Lemonade", "drink", "10", null, null],
  ["Something from a card", "", "", null, null],
  ["Another one nobody has sorted", "", "", null, null],
  ["A third unsorted recipe", "", "", null, null],
]) {
  const response = await setup.request.post(`${base}/api/recipes`, {
    data: {
      title, servings: "4", timeMinutes: minutes, sourceName: "", sourceUrl: "",
      ingredients: "2 cups flour\n1 pint double cream", steps: "Mix.\nBake.",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (body.id) made.push({ id: body.id, title, minutes, course, dishForm, protein });
}
/*
 * Classify them, so the chapter tree has chapters — and send the WHOLE recipe.
 *
 * This used to PATCH `{ course }` alone. `prepareRecipe` requires a title, so every one of those
 * calls returned 400 "a title is required", the `.catch(() => {})` swallowed it, and **no shot
 * has ever had a course on anything**: browse rendered one "Not sorted yet" chapter of nine and
 * looked perfectly fine in both themes. A fixture that silently fails produces a screenshot of
 * the wrong thing, and a screenshot is the one artefact nobody re-reads for correctness.
 *
 * So the response is checked now rather than discarded. A classification that does not stick is a
 * could-not-measure below, not a pass over an unclassified library.
 */
let classified = 0;
for (const [i, recipe] of made.entries()) {
  const patched = await setup.request
    .patch(`${base}/api/recipes/${recipe.id}`, {
      data: {
        title: recipe.title,
        servings: "4",
        timeMinutes: recipe.minutes,
        sourceName: "",
        ingredients: "2 cups flour\n1 pint double cream",
        steps: "Mix.\nBake.",
        course: recipe.course,
        dishForm: recipe.dishForm ?? "",
        principalProtein: recipe.protein ?? "",
      },
    })
    .catch(() => null);
  if (patched?.ok()) classified += 1;
  for (let n = 0; n < (i < 2 ? 3 : i < 5 ? 2 : 1); n += 1) {
    const day = new Date(Date.UTC(2026, 9, 12 + ((i + n) % 7))).toISOString().slice(0, 10);
    await setup.request.post(`${base}/api/plan-entries`, { data: { recipeId: recipe.id, date: day } }).catch(() => {});
  }
}
if (made.length < 7) {
  // seven is the rule's own number: fewer and the cap the layouts exist to apply is not exercised
  console.error(`COULD NOT MEASURE: only ${made.length} recipes were created, so no layout reaches its cap`);
  process.exit(2);
}
if (classified < made.length) {
  // the failure this check exists for: an unclassified library renders one chapter and looks fine
  console.error(`COULD NOT MEASURE: only ${classified} of ${made.length} recipes took a course, so the chapter tree is not exercised`);
  process.exit(2);
}
console.log(`  setup: household ${household.familyId.slice(0, 8)} with ${made.length} recipes, all ${classified} classified`);

await page0.close();

/*
 * Each screen names its own layout and **its own marker**.
 *
 * The marker used to be "Recipes" for every `recipes-*` screen — which the tab bar renders on all
 * of them, so it asserted that the tab bar was present and nothing whatever about the page above
 * it. "Each screen names something only it renders" was the stated intent and this is the first
 * version that does it: a chapter page has to say *its own chapter name* to count as rendered.
 */
const SCREENS = [
  { name: "today", path: "/today", marker: "Today" },
  { name: "recipes-rotation", path: "/recipes", layout: "rotation", marker: "What you cook" },
  { name: "recipes-browse", path: "/recipes", layout: "browse", marker: "The Lundall Recipe Book" },
  { name: "recipes-time", path: "/recipes", layout: "time", marker: "Recipes" },
  { name: "recipes-decide", path: "/recipes", layout: "decide", marker: "Recipes" },
  // the tree (§86): the divided chapter, a protein leaf, a small leaf, and the unsorted row
  { name: "chapter-main", path: "/recipes/c/main", layout: "browse", marker: "Mains" },
  { name: "chapter-pork", path: "/recipes/c/main/pork", layout: "browse", marker: "Pork" },
  { name: "chapter-soup", path: "/recipes/c/soup", layout: "browse", marker: "Soups" },
  { name: "chapter-unsorted", path: "/recipes/c/unsorted", layout: "browse", marker: "Not sorted yet" },
  /*
   * Appetisers earns a screen of its own because it is the one chapter whose artwork changed, and
   * the contents tile is only 46px of it. The hero is 52px, which is a different element on a
   * different surface — the hero was invisible once already (an inline <span> takes no width), and
   * that was found by looking at a picture rather than by any guard.
   */
  { name: "chapter-starter", path: "/recipes/c/starter", layout: "browse", marker: "Appetisers" },
  { name: "household", path: "/household", marker: "Household" },
];

let problems = 0;
let shots = 0;
/* name -> the light shot's bytes, so the dark pass can prove the theme actually changed something */
const lightBytes = new Map();

for (const theme of ["light", "dark"]) {
  for (const { name, path, layout, marker } of SCREENS) {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      colorScheme: theme === "dark" ? "dark" : "light",
      deviceScaleFactor: 2,
      extraHTTPHeaders: AUTH,
    });
    await context.addCookies([cookie]);
    const page = await context.newPage();
    if (layout) {
      await page.request.patch(`${base}/api/household`, { data: { recipeLayout: layout } });
    }
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    // the fonts decide every width below, so a shot before they land measures the fallback
    await page.evaluate(() => document.fonts.ready);

    /*
     * ---------------------------------------------------------------------------
     * Did any CSS arrive at all?
     * ---------------------------------------------------------------------------
     *
     * This tool exists because some faults are only visible in a picture, and it spent a whole
     * run photographing **unstyled HTML**: a stale dev server served
     * `<link href="/_next/static/css/app/layout.css">` that answered **404**, so every screen
     * rendered as Times serif with native form controls — and the run reported 14 screens `ok`
     * and 8 overflow problems that were artefacts of having no stylesheet.
     *
     * The tell was there and unread: **every light/dark pair was byte-identical**, because
     * there was no palette to vary. A theme emulation that reaches the page (`matchMedia`
     * agreed) and a palette that reaches the page are different facts.
     *
     * Same family as the fixture that silently failed above, and worse in one way — that one
     * left a plausible picture of the wrong data, this one left a picture of no design at all
     * and still called it a pass. So: the page must have a stylesheet with rules in it, and a
     * palette token must resolve. Exit 2, could-not-measure, never a FAIL — a run against a
     * broken server has measured nothing and must not read as a layout verdict.
     */
    const styling = await page.evaluate(() => {
      let rules = 0;
      let blocked = 0;
      for (const sheet of document.styleSheets) {
        try {
          rules += sheet.cssRules.length;
        } catch {
          blocked += 1;
        }
      }
      return {
        sheets: document.styleSheets.length,
        rules,
        blocked,
        /* a token from the generated palette: present in light and dark, so its absence is the stylesheet's */
        text: getComputedStyle(document.documentElement).getPropertyValue("--text").trim(),
      };
    });
    if (styling.sheets === 0 || (styling.rules === 0 && styling.blocked === 0) || !styling.text) {
      console.error(
        `  COULD NOT MEASURE ${name} (${theme}): no stylesheet reached the page — ` +
          `${styling.sheets} sheet(s), ${styling.rules} rule(s), --text=${styling.text || "(unset)"}. ` +
          `A shot of unstyled HTML is not a layout measurement. Restart the dev server and re-run.`,
      );
      await context.close();
      process.exit(2);
    }

    const png = await page.screenshot({ fullPage: true });
    writeFileSync(`${outDir}/${name}-${theme}.png`, png);
    shots += 1;

    /*
     * The two themes must differ, and this is the assertion the unstyled run should have failed.
     *
     * Every pair came back **byte-identical** — 11 screenshots written twice — and the run said
     * "22 screenshots in both themes". Nothing compared them, so the one fact that would have
     * exposed it sat in the file sizes. Playwright's `colorScheme` did reach the page
     * (`matchMedia` agreed); what did not reach it was a palette.
     *
     * No screen here is colourless, so identical bytes cannot be a legitimate outcome: it means
     * the dark palette did not apply. Could-not-measure rather than a FAIL, for the same reason
     * as the stylesheet check — this says the measurement did not happen, not that the layout is
     * wrong.
     */
    if (theme === "light") {
      lightBytes.set(name, png);
    } else if (lightBytes.get(name)?.equals(png)) {
      console.error(
        `  COULD NOT MEASURE ${name} (dark): byte-identical to the light shot, so the dark ` +
          `palette never applied — these are one screenshot written twice, not two themes.`,
      );
      problems += 1;
    }

    /*
     * The two things only a layout engine knows.
     */
    const found = await page.evaluate(() => {
      const out = { wider: 0, squeezed: [] };
      const doc = document.documentElement;
      // a page wider than its own viewport: the §81 chain, which breaks the docked bars
      out.wider = Math.max(0, doc.scrollWidth - doc.clientWidth);
      /*
       * Which element is doing it. "The page is 564px too wide" is a symptom and the next
       * question is always *what*, so the tool answers it rather than leaving a hunt — the
       * narrowest element whose own box extends past the viewport is the culprit, because an
       * ancestor is only wide because a descendant made it so.
       */
      out.culprits = [];
      if (out.wider > 0) {
        for (const el of document.querySelectorAll("body *")) {
          const box = el.getBoundingClientRect();
          if (box.right <= doc.clientWidth + 1 || box.width === 0) continue;
          // report the deepest ones: an ancestor inherits the overflow from its child
          const deeper = [...el.children].some((kid) => kid.getBoundingClientRect().right > doc.clientWidth + 1);
          if (deeper) { out.deeper = true; continue; }
          out.culprits.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || "").toString().slice(0, 44),
            right: Math.round(box.right),
            width: Math.round(box.width),
          });
        }
      }
      /*
       * A text box narrower than one word needs. `scrollWidth > clientWidth` on an element whose
       * own text is wrapping is the signature of the rotation fault: the box is 17px, the word
       * wants 80, and nothing in a stylesheet says so.
       */
      for (const el of document.querySelectorAll("h1, h2, h3, p, a, span, strong")) {
        const text = (el.textContent ?? "").trim();
        if (text.length < 4 || el.children.length > 0) continue;
        const box = el.getBoundingClientRect();
        /*
         * Only a zero *height* means not rendered. A first version skipped zero **width** too, as
         * "not laid out" — and zero width is exactly what the fault looks like: the broken titles
         * measured **0px wide and 329px tall**, the most broken box a text node can have, and the
         * guard filtered them out as absent. It reported ok on the screen it was written for.
         *
         * That is §80 inside the tool built to catch what guards cannot see: an assertion that
         * did not cover its own subject.
         */
        if (box.height === 0) continue;
        // a box so narrow that a word cannot fit is a broken box, whatever the stylesheet says
        if (box.width < 40 && text.length > 8) {
          out.squeezed.push({ text: text.slice(0, 40), width: Math.round(box.width), height: Math.round(box.height) });
        }
        /*
         * If every candidate was filtered as "has an overflowing child", nothing is reported and
         * a real overflow prints with no culprit — which happened on /household and sent me to a
         * separate probe. So the fallback reports the widest element regardless of depth.
         */
        if (out.culprits.length === 0) {
          const all = [...document.querySelectorAll("body *")]
            .map((el) => ({ el, box: el.getBoundingClientRect() }))
            .filter(({ box }) => box.right > doc.clientWidth + 1)
            .sort((a, b) => b.box.right - a.box.right)
            .slice(0, 3);
          out.culprits = all.map(({ el, box }) => ({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || "").toString().slice(0, 44),
            right: Math.round(box.right),
            width: Math.round(box.width),
          }));
        }
      }
      return out;
    });

    /*
     * Did this screen render *itself*? An error page, a redirect to sign-in, or a household that
     * failed to provision all produce a page with no overflow and no squeezed text — which is to
     * say, a clean pass. Each screen names something only it renders.
     */
    const body = await page.textContent("body");
    if (!body?.includes(marker) || body.includes("no household yet")) {
      console.error(`  COULD NOT MEASURE ${name} (${theme}): the page did not render its own content`);
      problems += 1;
      await context.close();
      continue;
    }

    const label = `${name} (${theme})`;
    if (found.wider > 0) {
      console.error(`  FAIL ${label}: the page is ${found.wider}px wider than the viewport`);
      for (const c of (found.culprits ?? []).slice(0, 3)) {
        console.error(`         ${c.tag}.${c.cls} is ${c.width}px wide and ends at ${c.right}`);
      }
      problems += 1;
    }
    for (const box of found.squeezed.slice(0, 4)) {
      console.error(`  FAIL ${label}: "${box.text}" is in a ${box.width}px box and ${box.height}px tall — it is wrapping per character`);
      problems += 1;
    }
    if (found.wider === 0 && found.squeezed.length === 0) console.log(`  ok   ${label}`);
    await context.close();
  }
}

await browser.close();
console.log(`\n${shots} screenshots in ${outDir}/ at ${WIDTH}px, against ${base}`);
if (problems > 0) {
  console.error(`${problems} layout problem(s) a stylesheet cannot show.`);
  process.exit(1);
}
