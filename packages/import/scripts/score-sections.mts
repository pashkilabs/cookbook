import { createHttpFetcher } from "../src/fetcher.js";
import { collectJsonLd, flattenNodes, findRecipeNode } from "../src/jsonld.js";
import { mapRecipeNode, buildNodeIndexFor } from "./score-sections-support.js";

/**
 * Score ingredient-section extraction against hand-written expectations.
 *
 * ---------------------------------------------------------------------------
 * Per field, because an aggregate hides the error that matters
 * ---------------------------------------------------------------------------
 *
 * Three different things can be wrong and they want different fixes, so they are scored apart:
 *
 *   DETECTED   did the reader find a grouping at all, and only where there is one
 *   VERBATIM   is each heading the page's own words, with nothing normalised away
 *   ASSIGNED   is every line under the heading it is written beneath
 *
 * `ASSIGNED` is the one an overall figure would bury. A recipe whose grouping is detected and whose
 * headings are perfect can still have every line one run too early, and that reads as plausible on
 * screen — the cook puts the parmesan in the marinade. Detection is the easy question standing in
 * for the hard one (§54a).
 *
 * ---------------------------------------------------------------------------
 * Two controls, and the first is the one that would be missed
 * ---------------------------------------------------------------------------
 *
 * **Over-assertion.** Recipes with no grouping must come back entirely unsectioned. A reader told
 * to find headings will find them, and a set made only of grouped recipes cannot fail in that
 * direction — which is the known-zero shape this project has already paid for once.
 *
 * **Ungrouped lines before the first heading.** Common on real cards and where an off-by-one puts
 * the first ingredients under the wrong name. Covered in the unit tests with exact markup; here it
 * is whatever the live pages actually do.
 *
 * Expectations are hand-written from reading the pages, not generated from a run — a fixture
 * written from the output it judges measures nothing.
 *
 * **Two of them were not, the first time, and this caught it.** `Bang Bang Chicken Bowl` and
 * `Greek Chicken Bowl` were written from the survey's *totals* — 17 and 16 — split across the
 * headings by eye, which is a guess wearing the costume of an expectation. The scorer reported
 * ASSIGNED 4/6 and both disagreements were mine: the pages say 4/6/7 and 9/7, and the JSON-LD order
 * confirms the boundaries (mayonnaise through Sriracha is the sauce, rice through sesame seeds is
 * the bowl; nine dressing ingredients ending at Kosher pepper, then quinoa onwards).
 *
 * Corrected from the pages rather than from the output — the distinction being that the block
 * boundaries were read and checked against the published ingredient order, not copied from what the
 * reader happened to return. A scorer that flags a disagreement is doing its job whichever side is
 * wrong, and here the measurement was right and the measurer was not.
 */
interface Expectation {
  label: string;
  url: string;
  /** every heading in page order; empty means the page groups nothing */
  sections: string[];
  /** how many ingredients sit under each heading, in the same order */
  counts: number[];
}

const SET: Expectation[] = [
  {
    label: "Homemade Spaghettios (reported)",
    url: "https://thecozycook.com/homemade-spaghettios/",
    sections: ["Sauce", "Mini Meatballs", "Pasta, etc."],
    counts: [6, 7, 6],
  },
  {
    label: "Parmesan Crusted Chicken (reported)",
    url: "https://lemonsandzest.com/parmesan-crusted-chicken-sheet-pan-dinner/",
    sections: ["For the Chicken", "For the Potatoes", "For the Green Beans"],
    counts: [7, 5, 5],
  },
  {
    label: "Bang Bang Chicken Bowl",
    url: "https://iamhomesteader.com/bang-bang-chicken-bowl/",
    sections: ["Bang Bang Sauce", "Chicken", "Bang Bang Chicken Bowl"],
    counts: [4, 6, 7],
  },
  {
    label: "Greek Chicken Bowl",
    url: "https://healthyfitnessmeals.com/greek-chicken-bowl/",
    sections: ["Dressing/Marinade", "Quinoa Bowls"],
    counts: [9, 7],
  },
  {
    label: "CONTROL: Baja Fish Tacos (no grouping)",
    url: "https://www.joyfulhealthyeats.com/epic-baja-fish-tacos-with-avocado-crema/",
    sections: [],
    counts: [],
  },
  {
    label: "CONTROL: Jerk Chicken (no grouping)",
    url: "https://www.chelseasmessyapron.com/jerk-chicken/",
    sections: [],
    counts: [],
  },
];

const fetcher = createHttpFetcher();
let detected = 0, verbatim = 0, assigned = 0, measured = 0;
const unreachable: string[] = [];

for (const expected of SET) {
  const page = await fetcher.page(expected.url).catch((e: Error) => ({ failed: e.message }) as never);
  if (!page || "failed" in page) {
    unreachable.push(`${expected.label} — ${(page as { failed?: string })?.failed?.slice(0, 60)}`);
    console.log(`  UNKNOWN  ${expected.label}  (could not fetch — not scored)`);
    continue;
  }
  const nodes = flattenNodes(collectJsonLd(page.html));
  const node = findRecipeNode(nodes);
  if (!node) {
    unreachable.push(`${expected.label} — no JSON-LD Recipe node`);
    console.log(`  UNKNOWN  ${expected.label}  (no recipe node — not scored)`);
    continue;
  }
  measured += 1;

  const recipe = mapRecipeNode({
    node, index: buildNodeIndexFor(nodes), baseUrl: expected.url,
    sourceUrl: expected.url, sourceName: null, html: page.html,
  });

  const runs: { heading: string | null; items: number }[] = [];
  for (const line of recipe.ingredients) {
    const heading = line.section ?? null;
    const last = runs[runs.length - 1];
    if (last && last.heading === heading) last.items += 1;
    else runs.push({ heading, items: 1 });
  }
  const named = runs.filter((r) => r.heading !== null);

  const okDetected = (named.length > 0) === (expected.sections.length > 0);
  const okVerbatim = named.map((r) => r.heading).join("|") === expected.sections.join("|");
  const okAssigned = okVerbatim && named.map((r) => r.items).join("|") === expected.counts.join("|");
  if (okDetected) detected += 1;
  if (okVerbatim) verbatim += 1;
  if (okAssigned) assigned += 1;

  const mark = okDetected && okVerbatim && okAssigned ? "ok     " : "WRONG  ";
  console.log(`  ${mark}${expected.label}`);
  if (!(okDetected && okVerbatim && okAssigned)) {
    console.log(`           want ${JSON.stringify(expected.sections)} ${JSON.stringify(expected.counts)}`);
    console.log(`           got  ${JSON.stringify(named.map((r) => r.heading))} ${JSON.stringify(named.map((r) => r.items))}`);
  }
}

console.log(`\n=== scored per field, over ${measured} of ${SET.length} ===`);
console.log(`  DETECTED a grouping, and only where there is one:  ${detected}/${measured}`);
console.log(`  VERBATIM headings, in the page's own words:        ${verbatim}/${measured}`);
console.log(`  ASSIGNED every line to the right run:             ${assigned}/${measured}`);
if (unreachable.length) {
  console.log(`\n${unreachable.length} UNKNOWN — a page that could not be read is not a page without sections:`);
  for (const u of unreachable) console.log(`  ${u}`);
}
process.exit(measured === 0 ? 2 : detected === measured && verbatim === measured && assigned === measured ? 0 : 1);
