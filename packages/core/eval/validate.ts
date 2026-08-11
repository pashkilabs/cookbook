import type { FixtureSet } from "./types.js";
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

    if (!fixture.expected.title.trim()) problems.push(`${where}: expected title is empty`);
    if (fixture.expected.ingredients.length === 0) {
      problems.push(`${where}: expected no ingredients — is the expectation filled in?`);
    }

    for (const [index, ingredient] of fixture.expected.ingredients.entries()) {
      const at = `${where}: ingredient[${index}]`;
      if (!ingredient.item.trim()) problems.push(`${at} has an empty item`);

      if (ingredient.amount !== null) {
        if (!Number.isFinite(ingredient.amount)) problems.push(`${at} amount is not a number`);
        else if (ingredient.amount <= 0) problems.push(`${at} amount is not positive`);
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
