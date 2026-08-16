import type { FixtureSet } from "./types.js";
import { REFUSAL_REASONS } from "./types.js";
import { canonicalUnit } from "../src/units.js";

/**
 * Check hand-authored fixtures for the mistakes hand-authoring makes: a
 * mistyped unit, a duplicate id, an expectation nobody filled in.
 *
 * A wrong fixture is worse than a missing one — it makes a correct extractor
 * look broken and sends you debugging the wrong thing. Returns human-readable
 * problems; empty means clean.
 */
export function validateFixtures(fixtures: FixtureSet): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const fixture of fixtures) {
    const where = fixture.id || "(fixture with no id)";
    if (!fixture.id) problems.push(`${where}: missing id`);
    else if (seen.has(fixture.id)) problems.push(`${where}: duplicate id`);
    seen.add(fixture.id);

    /*
     * A URL fixture's snapshot is a claim about a page at a moment (decisions §46's
     * sibling rule). Without the date, a fixture that stops matching the live page is
     * indistinguishable from one that was always wrong.
     */
    if (
      fixture.input.kind === "url" &&
      fixture.input.text &&
      !fixture.input.capturedAt &&
      // a placeholder's markup is invented rather than captured, so a capture date
      // would be a false claim about a page nobody fetched
      !fixture.placeholder
    ) {
      problems.push(`${where}: has a captured snapshot but no capturedAt date`);
    }

    if (fixture.expected.outcome === "refusal") {
      if (!REFUSAL_REASONS.includes(fixture.expected.because)) {
        problems.push(`${where}: ${JSON.stringify(fixture.expected.because)} is not a refusal reason`);
      }
      continue;
    }

    const expected = fixture.expected.recipe;
    // null is a statement ("this source names no dish"); "" is an unfilled field
    if (expected.title !== null && !expected.title.trim()) {
      problems.push(`${where}: expected title is empty — write null if the source names none`);
    }
    if (expected.ingredients.length === 0) {
      problems.push(`${where}: expected no ingredients — is the expectation filled in?`);
    }

    for (const [index, ingredient] of expected.ingredients.entries()) {
      const at = `${where}: ingredient[${index}]`;
      if (!ingredient.item.trim()) problems.push(`${at} has an empty item`);

      if (ingredient.amount !== null) {
        if (!Number.isFinite(ingredient.amount)) problems.push(`${at} amount is not a number`);
        else if (ingredient.amount <= 0) problems.push(`${at} amount is not positive`);
      }

      /*
       * A heading is not an ingredient (§45), and one written as an expected line would teach an
       * extractor that emitting it is correct. But a section named after its main ingredient is
       * ordinary — `1 cup orzo` under `ORZO:` is a real line, and the first version of this rule
       * failed it. A heading mis-parsed as a line has no quantity; a real ingredient does.
       */
      if (ingredient.section !== undefined && ingredient.section !== null
          && ingredient.amount === null && ingredient.unit === null
          && normaliseForHeading(ingredient.item) === normaliseForHeading(ingredient.section)) {
        problems.push(`${at} repeats its section as the ingredient — a heading is not a line`);
      }

      if (ingredient.unit === null) continue;
      const canonical = canonicalUnit(ingredient.unit);
      if (canonical === null) {
        problems.push(`${at} unit ${JSON.stringify(ingredient.unit)} is not a unit`);
      } else if (canonical === "count") {
        problems.push(`${at} unit ${JSON.stringify(ingredient.unit)} means a count — write null`);
      } else if (canonical !== ingredient.unit) {
        problems.push(
          `${at} unit ${JSON.stringify(ingredient.unit)} is not canonical — write ${JSON.stringify(canonical)}`,
        );
      }
    }
  }

  return problems;
}

const normaliseForHeading = (input: string): string =>
  input.trim().replace(/[:：]\s*$/, "").replace(/\s+/g, " ").toLowerCase();
