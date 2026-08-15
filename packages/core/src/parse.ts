import type { ParsedIngredient } from "./types.js";
import { CONTAINER_WORDS, canonicalUnit } from "./units.js";
import { expandFractions, readNumber, stripTags } from "./text.js";

const NUMBER = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?`;
const LEADING_BULLETS = /^[\u25a1\u25aa\u2022\u2023\u25e6\u25cf\u25cb\u2610\u2611▢□•·*\-–—]+\s*/;

/**
 * Qualifiers written in front rather than behind: "optional: sprigs of bay".
 *
 * `TRAILING_NOTES` only looks at the end of the line, so a leading one stayed glued to the name
 * and produced an ingredient called "optional: sprigs of bay" — which matches no catalog entry and
 * never will. Found in a real imported recipe.
 */
const LEADING_QUALIFIERS = /^(optional|to serve|for serving|to garnish|for garnish)\s*[:\-–—]\s*/i;

/** Trailing qualifiers that belong in the note, not the ingredient name. */
const TRAILING_NOTES = [
  "to taste", "for serving", "for garnish", "for topping", "for dusting",
  "optional", "divided", "plus more for serving", "plus more",
  "at room temperature", "or more to taste", "if needed", "or to taste",
];

/**
 * Read one written ingredient line into structured parts.
 *
 * Handles the shapes real recipes use:
 *   "1 ½ cups heavy cream, cold"
 *   "1 (14.5 ounce) can diced tomatoes, drained"
 *   "2 to 3 cloves garlic, minced"
 *   "Juice of 1 lemon"
 *   "▢ 8 oz cream cheese, softened"
 *
 * Returns null for anything that isn't an ingredient (headings, blank lines).
 */
export function parseIngredientLine(raw: string): ParsedIngredient | null {
  const original = String(raw ?? "");
  let text = stripTags(original).replace(LEADING_BULLETS, "").trim();
  if (!text || text.length > 200) return null;

  text = expandFractions(text);

  let leadingNote = "";
  const qualifier = LEADING_QUALIFIERS.exec(text);
  if (qualifier) {
    leadingNote = (qualifier[1] ?? "").toLowerCase();
    text = text.slice(qualifier[0].length).trim();
    if (!text) return null;
  }

  // "Juice of 1 lemon" / "Zest and juice of 2 limes"
  const citrus =
    /^(?:the\s+)?(juice|zest)\s+(?:and\s+(?:juice|zest)\s+)?of\s+(?:(\d+)\s*)?(?:an?\s+)?([a-z]+)/i.exec(text);
  if (citrus) {
    return {
      amount: readNumber(citrus[2] ?? "") ?? 1,
      unit: null,
      item: (citrus[3] ?? "").toLowerCase(),
      note: (citrus[1] ?? "").toLowerCase(),
      raw: original,
    };
  }

  let amount: number | null = null;
  let unitWord: string | null = null;
  let rest = text;
  let paren: { amount: number; unit: string } | null = null;

  // A range means "buy enough" — take the upper bound so we don't come up short.
  const range = new RegExp(`^(${NUMBER})\\s*(?:-|–|—|to|or)\\s*(${NUMBER})\\b`, "i").exec(rest);
  if (range) {
    const lo = readNumber(range[1] ?? "");
    const hi = readNumber(range[2] ?? "");
    amount = Math.max(lo ?? 0, hi ?? 0) || null;
    rest = rest.slice(range[0].length).trim();
  } else {
    const single = new RegExp(`^(${NUMBER})\\b`).exec(rest);
    if (single) {
      amount = readNumber(single[1] ?? "");
      rest = rest.slice(single[0].length).trim();
    }
  }

  /*
   * "1 x 1.5kg free-range whole chicken", "2 x 400g tins chopped tomatoes".
   *
   * British recipe writing, and it defeated the parser completely: the leading number was taken as
   * the amount and everything after it — including the real weight — became the ingredient name.
   * The multiplication is the correct reading either way: one chicken of 1.5 kg is 1.5 kg, and two
   * tins of 400 g is 800 g, which is what a shopping list needs.
   */
  const multiplied = new RegExp(`^[x×]\\s*(${NUMBER})\\s*([a-zA-Z]+)\\b`).exec(rest);
  if (amount !== null && multiplied) {
    const each = readNumber(multiplied[1] ?? "");
    const candidate = multiplied[2] ?? "";
    if (each != null && canonicalUnit(candidate) !== null && canonicalUnit(candidate) !== "count") {
      amount *= each;
      unitWord = candidate;
      rest = rest.slice(multiplied[0].length).trim();
    }
  }

  const takeParenthetical = (): void => {
    const m = new RegExp(`^\\(\\s*(${NUMBER})\\s*-?\\s*([a-zA-Z]+)\\.?\\s*\\)`).exec(rest);
    if (!m) return;
    const value = readNumber(m[1] ?? "");
    if (value == null) return;
    paren = { amount: value, unit: m[2] ?? "" };
    rest = rest.slice(m[0].length).trim();
  };

  takeParenthetical(); // "1 (14.5 oz) can tomatoes"

  // Not when the multiplier already established one: "2 x 400g tins" is 800 grams, and letting
  // "tins" win here made it 800 cans.
  const word = unitWord === null ? /^([a-zA-Z]+)\.?/.exec(rest) : null;
  if (word) {
    const candidate = word[1] ?? ""; // case preserved so "T" and "t" stay distinct
    if (canonicalUnit(candidate) !== null) {
      unitWord = candidate;
      rest = rest.slice(word[0].length).trim();
      if (/^of\s/i.test(rest)) rest = rest.slice(3).trim();
    }
  }

  if (!paren) takeParenthetical(); // "1 can (14.5 oz) tomatoes"

  // A sized container is worth more than a count of tins.
  if (paren && unitWord && CONTAINER_WORDS.has(unitWord.toLowerCase())) {
    const inner = canonicalUnit((paren as { unit: string }).unit);
    if (inner && inner !== "count" && inner !== "can") {
      amount = (amount ?? 1) * (paren as { amount: number }).amount;
      unitWord = (paren as { unit: string }).unit;
    }
  }

  let note = leadingNote;
  const comma = rest.indexOf(",");
  if (comma > 0) {
    note = [note, rest.slice(comma + 1).trim()].filter(Boolean).join(", ");
    rest = rest.slice(0, comma).trim();
  }

  const trailingParen = /\(([^)]+)\)\s*$/.exec(rest);
  if (trailingParen) {
    note = [trailingParen[1], note].filter(Boolean).join(", ");
    rest = rest.slice(0, trailingParen.index).trim();
  }

  for (const phrase of TRAILING_NOTES) {
    const re = new RegExp(`[,\\s]*\\b${phrase}\\b\\.?\\s*$`, "i");
    if (re.test(rest)) {
      rest = rest.replace(re, "").trim();
      note = [phrase, note].filter(Boolean).join(", ");
    }
  }

  rest = rest.replace(/^of\s+/i, "").replace(/[.,;:]+$/, "").trim();
  if (!rest || /^[\d\s.,/]*$/.test(rest)) return null;

  const unit = canonicalUnit(unitWord);
  return {
    amount,
    // "count" is implicit for whole things; store null so displays stay clean
    unit: unit === "count" ? null : unit,
    item: rest.toLowerCase(),
    note,
    raw: original,
  };
}

/** Parse a whole ingredient list, discarding anything that isn't one. */
export function parseIngredientList(lines: string[]): ParsedIngredient[] {
  return lines
    .map((line) => parseIngredientLine(line))
    .filter((x): x is ParsedIngredient => x !== null);
}
