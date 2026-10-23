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
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

/*
 * Two viewports, because "clean" meant "clean at one width" and nothing asked which.
 *
 * 390px is the phone every layout claim in this project has been made about — §81's overflow
 * work, the 0px-wide titles, the score grid, all of it. **Nothing above phone width had ever been
 * rendered**, and both people using this app have an iPad on the kitchen counter. The recipe
 * book's chapter tiles sit in a narrow left column there with most of the screen empty, which is
 * the symptom; the cause is that no picture was ever taken.
 *
 * 1024x768 is the honest second one: an iPad in landscape, which is how a tablet sits on a
 * counter. Not a desktop monitor — nobody has reported one, and a width nobody uses would add
 * findings nobody needs.
 */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 1024, height: 768 },
  /*
   * A desktop browser, because the report that made this necessary came from one and 1024px would
   * not have shown it: `main` caps at `60rem` and centres, so every width past 960px only widens
   * the empty margins. The question a wide screen asks is not "does anything overflow" but "does
   * the capped column still make sense" — and that needs looking at, not asserting.
   */
  { name: "desktop", width: 1440, height: 900 },
];
/** the phone stays the default for the setup context and for anything measured once */
const WIDTH = VIEWPORTS[0].width;
const HEIGHT = VIEWPORTS[0].height;

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
/* the Monday of the current week, so the planner and the shopping list are never shot empty */
const MONDAY = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  d.setUTCHours(0, 0, 0, 0);
  return d;
})();

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
      /*
       * `spinach` carries **no amount**, deliberately. 118 of 1407 live ingredient lines are like
       * that, and the screen rendered them as "0 spinach" — so without one here the fix for that
       * is in the code and in no picture. A fixture that cannot produce the case cannot show it.
       */
      ingredients: "2 cups flour\n1 pint double cream\nspinach", steps: "Mix.\nBake.",
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
        ingredients: "2 cups flour\n1 pint double cream\nspinach",
        steps: "Mix.\nBake.",
        course: recipe.course,
        dishForm: recipe.dishForm ?? "",
        principalProtein: recipe.protein ?? "",
      },
    })
    .catch(() => null);
  if (patched?.ok()) classified += 1;
  for (let n = 0; n < (i < 2 ? 3 : i < 5 ? 2 : 1); n += 1) {
    /*
     * **This week**, computed — it was `Date.UTC(2026, 9, 12 + …)`, a literal that was the current
     * week on the day it was written and had rotted eleven days later.
     *
     * The consequence was not a failed shot. `/shopping` and `/planner` both render by the week
     * being viewed, so with the plan in a past week they rendered "No list yet" and "0 of 7
     * dinners — waiting for a day", and the run reported both **ok**. A screen photographed in its
     * empty state is a screen whose populated state nothing has looked at, and the share control
     * lives inside `plannedCount > 0`, so it had never appeared in a screenshot at all.
     *
     * *Route coverage is not state coverage*, and a hard-coded date is a fixture with an expiry
     * nobody set a reminder for.
     */
    const day = new Date(MONDAY);
    day.setUTCDate(day.getUTCDate() + ((i + n) % 7));
    await setup.request.post(`${base}/api/plan-entries`, {
      data: { recipeId: recipe.id, date: day.toISOString().slice(0, 10) },
    }).catch(() => {});
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
  /*
   * `/shopping`, which was **not on this list** until the week's typed extras landed on it.
   *
   * Worth saying plainly: `pnpm shots` reported "22 screenshots, zero layout problems" for a
   * change to a screen it never opened, and that was about to be quoted as evidence. The same
   * adjacent-claim fault the helper list below collects, arriving through how the tool was *used*
   * rather than how it is written — the brief says render anything that changes a layout, and a
   * clean run over ten other screens is not that.
   *
   * The marker is the add control's own label: it is content only this screen renders, it is
   * there whether or not anything is planned, and its absence means the screen did not render
   * what it should rather than that a layout is wrong.
   */
  /*
   * `/planner` — the fourth screen this tool reported clean without opening.
   *
   * The marker is the eyebrow, which is on the screen in every state. It was "Add dinner", the
   * empty slot's own words, chosen while the fixture planned nothing — and the moment the fixture
   * planned something that marker vanished and the screen reported COULD NOT MEASURE. A marker
   * tied to one state is a marker that expires when the fixture changes, which is the same rot as
   * the hard-coded week it was chosen against.
   */
  { name: "planner", path: "/planner", marker: "Week plan" },
  { name: "shopping", path: "/shopping", marker: "Anything else you need" },
  { name: "household", path: "/household", marker: "Household" },
  { name: "recipe-new", path: "/recipes/new", marker: "Add a recipe" },
  { name: "import", path: "/recipes/import", marker: "One link" },
  /*
   * `/sign-in` carries no session, because the page **redirects a signed-in visitor to
   * /recipes** — so the harness could never have rendered it with the cookie attached, and
   * listing it as an unrendered static route implied an oversight rather than a reason.
   *
   * It holds one of the ten buttons that relied on the bare `button` element selector, which is
   * why it is here now: a scoping change cannot be checked by looking at screens that do not
   * show the thing being scoped.
   */
  { name: "sign-in", path: "/sign-in", marker: "Sign in", signedOut: true },
];

let problems = 0;
let shots = 0;
/* name -> the light shot's bytes, so the dark pass can prove the theme actually changed something */
const lightBytes = new Map();
/* how much the selected-state check actually got to compare, summed over every screen and theme */
let pressedCandidates = 0;
let pressedComparable = 0;

for (const viewport of VIEWPORTS) {
 for (const theme of ["light", "dark"]) {
  for (const { name, path, layout, marker, signedOut } of SCREENS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme === "dark" ? "dark" : "light",
      deviceScaleFactor: 2,
      ...(signedOut ? {} : { extraHTTPHeaders: AUTH }),
    });
    if (!signedOut) await context.addCookies([cookie]);
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
        `  COULD NOT MEASURE ${name} (${viewport.name} ${theme}): no stylesheet reached the page — ` +
          `${styling.sheets} sheet(s), ${styling.rules} rule(s), --text=${styling.text || "(unset)"}. ` +
          `A shot of unstyled HTML is not a layout measurement. Restart the dev server and re-run.`,
      );
      await context.close();
      process.exit(2);
    }

    const png = await page.screenshot({ fullPage: true });
    /* the viewport is in the filename, or the second pass silently overwrites the first */
    const shotName = viewport.name === "phone" ? `${name}-${theme}` : `${name}-${viewport.name}-${theme}`;
    writeFileSync(`${outDir}/${shotName}.png`, png);
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
      lightBytes.set(`${viewport.name}:${name}`, png);
    } else if (lightBytes.get(`${viewport.name}:${name}`)?.equals(png)) {
      console.error(
        `  COULD NOT MEASURE ${name} (${viewport.name} dark): byte-identical to the light shot, so the dark ` +
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
        /*
         * Text that is **meant** to be invisible is not squeezed text.
         *
         * `.h-sr-only` is a 1px box with `clip-path: inset(50%)` — the standard visually-hidden
         * pattern, deliberately left in the accessibility tree rather than `display: none`. The
         * planner gives every day one as its heading, so the first run of that screen reported
         * four FAILs per theme against markup that is exactly right.
         *
         * Matched on the **computed style** rather than the class name: an element clipped away
         * says nothing about readability whatever it is called, and keying on `h-sr-only` would be
         * a guess about a spelling that the next sr-only implementation would defeat.
         */
        if (getComputedStyle(el).clipPath !== "none") continue;
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
    /*
     * ---------------------------------------------------------------------------
     * Does a selected segment look different from an unselected one?
     * ---------------------------------------------------------------------------
     *
     * The units control on `/household` rendered **US and Metric both filled terracotta** in both
     * themes, for as long as Harvest has existed. `units.tsx` wrote `.button.selected` while the
     * redesign had named the rule `.h-segmented button.is-selected`, so the class was applied and
     * styled by nothing — both segments fell through to the bare `button` element selector.
     *
     * **Every guard was green and none of them could have seen it.** `check-harvest-classes` asks
     * which `h-` classes nothing styles, and `selected` is not an `h-` class; the primitives test
     * tests the primitive, which was correct and simply unused. `aria-pressed` was right
     * throughout, so smoke's marker checks passed too.
     *
     * Two static-analysis attempts at a complement guard both missed it — the state class lives
     * inside a `${...}` interpolation, which both versions stripped. So this is a *rendering*
     * question and it belongs here, the same conclusion the 0px-wide title reached: when a
     * stylesheet and a screenshot disagree, the screenshot is the one that has looked.
     *
     * Could-not-measure, not FAIL, when a group has no unpressed sibling: a two-way control with
     * both segments on, or a one-segment group, cannot answer the question.
     */
    const states = await page.evaluate(() => {
      const groups = new Map();
      for (const el of document.querySelectorAll("[aria-pressed], [aria-checked]")) {
        const value = el.getAttribute("aria-pressed") ?? el.getAttribute("aria-checked");
        if (value !== "true" && value !== "false") continue;
        const parent = el.parentElement;
        if (!parent) continue;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push({ el, on: value === "true" });
      }

      /*
       * Everything a control might legitimately distinguish itself by — and the list grew twice,
       * both times because the first version false-alarmed on correct code.
       *
       * `borderColor` is here because `.h-option.is-on` sets **border-color alone**, and a first
       * version comparing only background, weight, shadow and colour reported the layout
       * radiogroup as identical when it is plainly not. The **descendants** are here for the same
       * reason one step down: that control also fills a child ring (`.h-radio.is-on`), and a
       * control whose only difference is in a child is still a distinguishable control.
       *
       * Widening a comparison weakens a check, so it is worth being explicit: every property added
       * here is one more way for a control to count as different, and the narrowest condition that
       * separates the legitimate case is the right one — never an exemption for the class that
       * tripped it, which would have been a blanket allow over a real signal.
       */
      const signature = (el) => {
        const own = getComputedStyle(el);
        const parts = [own.backgroundColor, own.color, own.fontWeight, own.boxShadow, own.borderColor, own.outlineColor];
        for (const child of el.querySelectorAll("*")) {
          const style = getComputedStyle(child);
          parts.push(style.backgroundColor, style.borderColor, style.color, style.fontWeight);
        }
        return parts.join("|");
      };

      const identical = [];
      let candidates = 0;
      let comparable = 0;
      for (const [parent, members] of groups) {
        /*
         * A group of ONE is a standalone toggle, not a segmented control — the shortlist button on
         * a recipe tile is `aria-pressed` on its own and has no sibling by design. A first version
         * counted those as "could not compare" and reported three screens as unmeasurable, which
         * is noise a guard gets switched off for (§85's ratio lesson). Two or more members with
         * the attribute is what makes a group a candidate at all.
         */
        if (members.length < 2) continue;
        candidates += 1;
        const on = members.find((m) => m.on);
        const off = members.find((m) => !m.on);
        if (!on || !off) continue;
        comparable += 1;
        if (signature(on.el) === signature(off.el)) {
          const style = getComputedStyle(on.el);
          identical.push({
            group: (parent.className || parent.tagName).toString().slice(0, 40),
            labels: members.map((m) => (m.el.textContent || "").trim().slice(0, 14)).join(" / "),
            background: style.backgroundColor,
            weight: style.fontWeight,
          });
        }
      }
      return { candidates, comparable, identical };
    });

    for (const fault of states.identical) {
      console.error(
        `  FAIL ${name} (${theme}): selected and unselected render identically in .${fault.group}`,
      );
      console.error(
        `         ${fault.labels} — same background ${fault.background}, weight ${fault.weight}, shadow, colour, border and children`,
      );
      problems += 1;
    }
    /*
     * Coverage is accumulated and printed once, and a screen with nothing selected is **not** a
     * problem.
     *
     * A first version reported could-not-measure per screen whenever no group had both a selected
     * and an unselected member, and incremented `problems`. That fired on 6 of 22 shots — the
     * `/recipes` layouts, where the shortlist buttons are simply all unpressed — so an entirely
     * normal screen state failed the run. A check that fails routinely is one people learn to
     * ignore, which is worse than no check (the `check-migrations-pushed` argument, in a renderer).
     *
     * But silence must not read as success either, so the run says how much it actually compared.
     * "0 of N groups comparable" and "14 of N" are the difference between a check that ran and a
     * check that was present, and only the printed number tells them apart.
     */
    pressedCandidates += states.candidates;
    pressedComparable += states.comparable;

    /*
     * ---------------------------------------------------------------------------
     * Is a glyph rendering at the size it declares?
     * ---------------------------------------------------------------------------
     *
     * The share control on /shopping rendered its SVG **7px wide against a declared 18** —
     * `.h-icon` set width and height and never reset the padding the bare `button` element
     * selector imposes, so a 44px circle had a 6.8px content box. The week arrows beside it were
     * fine because `IconLink` is an `<a>` and escapes that selector entirely: same class, same
     * circle, same declared size, opposite outcomes.
     *
     * **No instrument could see it.** `check-contrast` reads colour and the glyph was correctly
     * coloured; the selected-state check compares pressed against unpressed and this is neither;
     * the overflow check measures width against the viewport and a crushed glyph overflows
     * nothing. It was found by somebody looking at the screen — the third such fault this week.
     *
     * So the measurement becomes the check. An SVG that declares a size and renders smaller is
     * being squeezed by something, whatever the cause, and that is a fact a layout engine knows
     * and a stylesheet cannot tell you. Asserted at **80%** rather than exactly, because
     * fractional layout and transforms move a box by a pixel without anything being wrong.
     */
    const glyphs = await page.evaluate(() => {
      const crushed = [];
      for (const svg of document.querySelectorAll("svg[width][height]")) {
        const declared = { w: Number(svg.getAttribute("width")), h: Number(svg.getAttribute("height")) };
        if (!declared.w || !declared.h) continue;
        const box = svg.getBoundingClientRect();
        /* not rendered at all is a different question, and the marker check below owns it */
        if (box.width === 0 && box.height === 0) continue;
        if (box.width >= declared.w * 0.8 && box.height >= declared.h * 0.8) continue;
        const owner = svg.closest("button, a") ?? svg.parentElement;
        crushed.push({
          where: (owner?.getAttribute("aria-label") || owner?.className || owner?.tagName || "?")
            .toString()
            .slice(0, 36),
          declared: `${declared.w}x${declared.h}`,
          rendered: `${Math.round(box.width)}x${Math.round(box.height)}`,
        });
      }
      return crushed;
    });
    for (const g of glyphs) {
      console.error(
        `  FAIL ${name} (${viewport.name} ${theme}): a glyph declares ${g.declared} and renders ${g.rendered} — ${g.where}`,
      );
      problems += 1;
    }

    /*
     * ---------------------------------------------------------------------------
     * Do the top-level sections of a screen agree on a container width?
     * ---------------------------------------------------------------------------
     *
     * The one positive assertion among a dozen boundary checks. Overflow asks whether something
     * left its container, squeezed text whether a box fell below a word, contrast whether two
     * values are too close, crushed glyph whether a box fell below its own declaration — every one
     * detects a value leaving a permitted range, and **emptiness is inside every range there is**.
     * A layout can be maximally wrong in that direction with every instrument green, because there
     * is nothing to violate. That is how a three-column card grid squeezing whole sections into
     * 296px slots survived every check at every width.
     *
     * This asserts something instead: the direct children of `main` share a width. Objective, no
     * magic number, and no argument with a capped reading column — a cap applied consistently
     * passes, which is why there is deliberately **no "wasted space" percentage** here. A check
     * that argues with a legitimate design choice every run is a check that gets switched off.
     *
     * Printed rather than failed, for now: three screens disagree today (`today` and `planner` by
     * a deliberate-looking 40px inset, `import` by a `stack` at 416px inside 920px) and a check
     * that fails on first introduction gets silenced rather than read.
     */
    if (theme === "light") {
      const blocks = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return [];
        /* every direct child of main, which is what "one container width" is a claim about */
        return [...main.children]
          .map((el) => {
            const b = el.getBoundingClientRect();
            return {
              cls: (el.className || el.tagName).toString().slice(0, 30),
              width: Math.round(b.width),
            };
          })
          .filter((b) => b.width > 0);
      });
      const widths = [...new Set(blocks.map((b) => b.width))];
      if (widths.length > 1) {
        console.error(
          `    sections disagree on width: ${blocks.map((b) => `${b.cls}=${b.width}`).join(", ")}`,
        );
      }
      /*
       * Scroll to the bottom and ask whether the last content element clears the bar.
       *
       * Measured this way because guessing which element carries the reservation got it wrong
       * twice: `main`'s own `padding-bottom` is 48px, which looks 36px short of an 84px bar — and
       * the reservation is actually on `.h-docked-page` at `84 + safe-area + 24`. The question a
       * person has is not "which element has the padding" but "can I read the last line", so that
       * is what this asks.
       */
      const reach = await page.evaluate(async () => {
        const bar = document.querySelector(".h-tabbar");
        const main = document.querySelector("main");
        if (!bar || !main) return null;
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const barTop = bar.getBoundingClientRect().top;
        const hidden = [...main.querySelectorAll("*")]
          .map((el) => ({ el, b: el.getBoundingClientRect() }))
          .filter(({ b }) => b.height > 0 && b.width > 0 && b.top < barTop && b.bottom > barTop);
        window.scrollTo(0, 0);
        return hidden.length === 0
          ? null
          : { count: hidden.length, first: (hidden[0].el.textContent || "").trim().slice(0, 30) };
      });
      if (reach) {
        console.error(
          `    ${reach.count} element(s) still under the bar at full scroll — e.g. "${reach.first}"`,
        );
      }
    }

    const body = await page.textContent("body");
    if (!body?.includes(marker) || body.includes("no household yet")) {
      console.error(`  COULD NOT MEASURE ${name} (${viewport.name} ${theme}): the page did not render its own content`);
      problems += 1;
      await context.close();
      continue;
    }

    const label = `${name} (${viewport.name} ${theme})`;
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
}

await browser.close();
/*
 * ---------------------------------------------------------------------------
 * Which screens did this run NOT look at?
 * ---------------------------------------------------------------------------
 *
 * The inverse question, the one `check-tests-run` and `check-typechecked` ask, asked about
 * screenshots — and it is overdue. **Three times this tool has reported on something it was not
 * looking at**: a fixture that set no course (§86), a stylesheet that answered 404, and
 * `/shopping`, which was simply not on the list while a change to it was being verified against a
 * clean run over ten other screens. `/planner` is the fourth and was absent the whole time.
 *
 * "Clean" meant "clean for the screens I happened to open", and nothing asked which those were.
 * So the run now prints its own coverage against the routes that exist.
 *
 * **Printed, never failed.** A dynamic route needs a fixture id this harness does not have, so a
 * check that refused an uncovered route would fail on `/cook/[id]` and `/invite/[token]` on every
 * run — and a check that fails routinely is one people learn to ignore, which is worse than no
 * check. Dynamic routes are listed separately for that reason: they are a judgement about
 * fixtures, not an oversight.
 */
function pageRoutes(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      /* a route group — `(marketing)` — adds no segment to the URL */
      const segment = /^\(.*\)$/.test(entry) ? prefix : `${prefix}/${entry}`;
      found.push(...pageRoutes(path, segment));
    } else if (entry === "page.tsx") {
      found.push(prefix === "" ? "/" : prefix);
    }
  }
  return found;
}

const appDir = "apps/web/app";
let coverage = null;
if (existsSync(appDir)) {
  const routes = pageRoutes(appDir).sort();
  const shot = SCREENS.map((screen) => screen.path.split("?")[0]);

  /*
   * A concrete path covers the dynamic route it matches: `/recipes/c/main` is a shot of
   * `/recipes/c/[chapter]`. A first version compared strings, so it listed six dynamic routes as
   * needing a fixture while five of them were being rendered — an **overstated** gap, which is
   * the false-alarm shape that gets a check switched off within a day.
   */
  const covers = (route, path) => {
    const pattern = new RegExp(
      `^${route.replace(/[.*+?^${}()|\\]/g, "\\$&").replace(/\[[^\]]+\]/g, "[^/]+")}$`,
    );
    return pattern.test(path);
  };
  /*
   * A path that IS a static route cannot stand in for a dynamic one. Next prefers the static
   * match, so a shot of `/recipes/blend` renders that page and not `/recipes/[id]` — crediting it
   * would **understate** the gap, which is the direction that hides a problem rather than
   * inventing one.
   */
  const staticRoutes = new Set(routes.filter((route) => !route.includes("[")));
  const rendered = routes.filter((route) =>
    shot.some((path) =>
      route.includes("[") ? !staticRoutes.has(path) && covers(route, path) : route === path,
    ),
  );
  const uncovered = routes.filter((route) => !rendered.includes(route));
  coverage = {
    total: routes.length,
    rendered: rendered.length,
    missing: uncovered.filter((route) => !route.includes("[")),
    dynamic: uncovered.filter((route) => route.includes("[")),
  };
}

console.log(
  `\n${shots} screenshots in ${outDir}/ at ${VIEWPORTS.map((v) => `${v.width}px`).join(" and ")}, against ${base}`,
);
if (coverage) {
  console.log(`  screens: ${coverage.rendered} of ${coverage.total} route(s) rendered.`);
  if (coverage.missing.length > 0) {
    console.log(`  NOT RENDERED — a clean run says nothing about these: ${coverage.missing.join(", ")}`);
  }
  if (coverage.dynamic.length > 0) {
    console.log(`  needs a fixture id, so not rendered: ${coverage.dynamic.join(", ")}`);
  }
} else {
  console.log(`  screens: COULD NOT MEASURE — ${appDir} is not there, so coverage is unknown.`);
}
console.log(
  pressedCandidates === 0
    ? "  selected-state: no multi-member pressed/checked group on any screen — nothing to compare."
    : `  selected-state: ${pressedComparable} of ${pressedCandidates} group(s) had both a selected and an ` +
      `unselected member and were compared; the rest had nothing selected.`,
);
if (problems > 0) {
  console.error(`${problems} layout problem(s) a stylesheet cannot show.`);
  process.exit(1);
}
