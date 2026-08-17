import type { ParsedIngredient } from "./types.js";
import { CONTAINER_WORDS, canonicalUnit, containerWord } from "./units.js";
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
  // prep the tin arrives needing, written without a comma on plenty of UK sites
  "drained and rinsed", "drained", "rinsed", "peeled and deveined", "finely minced",
  "room temp", "melted and cooled", "freshly grated", "thinly sliced",
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

  /*
   * A number is over when the digits are, even if a letter follows it immediately.
   *
   * regression: this was `\b`, and there is no word boundary between `0` and `m` — both are word
   * characters. So `150ml` matched nothing at all and the entire line became the ingredient name,
   * while `150 ml` parsed perfectly. British sites write the unit closed up more often than not,
   * which made a whole class of import silently unmatchable: four such lines were sitting in
   * production, and re-importing them would have produced them again.
   */
  const NUMBER_END = String.raw`(?![\d.,/])`;

  // A range means "buy enough" — take the upper bound so we don't come up short.
  const range = new RegExp(
    `^(${NUMBER})\\s*(?:-|–|—|to|or)\\s*(${NUMBER})${NUMBER_END}`,
    "i",
  ).exec(rest);
  if (range) {
    const lo = readNumber(range[1] ?? "");
    const hi = readNumber(range[2] ?? "");
    amount = Math.max(lo ?? 0, hi ?? 0) || null;
    rest = rest.slice(range[0].length).trim();
  } else {
    const single = new RegExp(`^(${NUMBER})${NUMBER_END}`).exec(rest);
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

  /*
   * A restated measure: "20g/ 1 1/2 tbsp unsalted butter", "1kg / 2lb chicken", "250g/8oz tomatoes".
   *
   * RecipeTin Eats writes every line this way and it is one of the household's most-used sources.
   * The parser took the first measure and left the rest of it — slash and all — glued to the front
   * of the ingredient, so `unsalted butter` became `/ 1 1/2 tbsp unsalted butter` and matched
   * nothing in the catalog. The second measure is the *same quantity said again*, not more food,
   * so it is dropped rather than added.
   *
   * A number after the slash is what makes it a measure. `cooking salt / kosher salt` and
   * `chicken broth/stock` are alternatives between two foods and must survive untouched.
   */
  if (amount !== null) {
    const restated = new RegExp(`^/\\s*(${NUMBER})\\s*([a-zA-Z]+)\\.?\\b`).exec(rest);
    if (restated && canonicalUnit(restated[2] ?? "") !== null) {
      rest = rest.slice(restated[0].length).trim();
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

  /*
   * WPRM wraps an already-parenthesised note in parentheses of its own, so RecipeTin Eats emits
   * `cumin ((sub coriander, thyme leaves crushed between fingers, or omit))`. Collapsed before
   * anything reads them, because every rule below assumes one level.
   */
  rest = rest.replace(/\(\s*\(/g, "(").replace(/\)\s*\)/g, ")");

  /*
   * "½ tsp EACH salt and pepper" — one amount, two ingredients, and the word that says so.
   *
   * The line cannot become two rows here: this function returns one ingredient, and splitting it
   * would change the shape of every caller. What it can do is stop `each` becoming part of the
   * food, so the item is `salt and pepper` rather than `each salt and pepper` — which at least
   * matches a catalog entry and reads correctly on a list. Splitting properly is a change to
   * `parseIngredientList`, which is where a line may legitimately become two.
   */
  rest = rest.replace(/^each\s+/i, "");

  /*
   * "1 pinch crushed red pepper", "a dash of hot sauce", "a handful of parsley".
   *
   * A pinch is not a unit — nothing converts it and no shopping list buys one — so it belongs in
   * the note, not glued to the front of the food. The amount goes with it: "1 pinch" is one
   * pinch, not one crushed red pepper, and leaving the 1 behind would claim a quantity the
   * recipe never gave.
   */
  // "a pinch of" as often as "1 pinch": the article is not a number, so it is still sitting here
  const vague = /^(?:an?\s+)?(pinch|pinches|dash|dashes|handful|handfuls|splash|splashes|sprinkle|drizzle|squeeze)e?s?\s+(?:of\s+)?/i.exec(rest);
  if (vague) {
    leadingNote = [leadingNote, (vague[1] ?? "").toLowerCase()].filter(Boolean).join(", ");
    rest = rest.slice(vague[0].length).trim();
    amount = null;
    unitWord = null;
  }

  /*
   * "2 x 400g cans cannellini beans" — the multiplier already turned this into 800 g, so the
   * container word is spent. It was left on the front of the food, giving `cans cannellini beans`.
   * Only stripped when a real measure was established, so "2 cans tomatoes" keeps its cans.
   */
  if (unitWord !== null && containerWord(canonicalUnit(unitWord)) === null) {
    const spentContainer = /^([a-zA-Z]+)\s+/.exec(rest);
    if (spentContainer && CONTAINER_WORDS.has((spentContainer[1] ?? "").toLowerCase())) {
      rest = rest.slice(spentContainer[0].length).trim();
    }
  }

  /*
   * "2 tbsp honey or 1 tbsp sugar" — an alternative with its own measure.
   *
   * The first is the recipe's choice; the rest is a substitution note. Kept as a note rather than
   * dropped, because "or maple syrup" is the sort of thing somebody standing in a shop wants.
   * Only fires when the alternative carries a *number*, so "salt or pepper" and "chicken broth or
   * stock" are left alone as the single ingredients they are.
   */
  const alternative = new RegExp(`\\s+or\\s+(${NUMBER})\\s*[a-zA-Z]`, "i").exec(rest);
  if (alternative && alternative.index > 0) {
    leadingNote = [leadingNote, rest.slice(alternative.index + 1).trim()].filter(Boolean).join(", ");
    rest = rest.slice(0, alternative.index).trim();
  }

  let note = leadingNote;
  const comma = firstCommaOutsideParens(rest);
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

/**
 * The first comma that separates the ingredient from its note — ignoring any inside brackets.
 *
 * regression: the split used `indexOf(",")`, so `cumin (sub coriander, thyme, or omit)` broke at
 * the comma *inside* the note and left the ingredient as `cumin (sub coriander`. Nothing in a
 * catalog matches that, and the failure looked like a missing ingredient rather than a mis-split.
 */
function firstCommaOutsideParens(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) return i;
  }
  return -1;
}

/**
 * Parse lines that each know the heading they sat under.
 *
 * Kept separate from `parseIngredientList` rather than folded into it: that function takes
 * strings and is called from a dozen places, and a second parameter meaning "and here are the
 * headings, positionally" is the kind of API that goes wrong silently. A model returns the pair
 * together, so it hands the pair over together.
 */
export function parseSectionedIngredients(
  lines: readonly { text: string; section?: string | null }[],
): ParsedIngredient[] {
  const parsed = parseIngredientList(lines.map((line) => line.text));
  /*
   * `parseIngredientList` drops what it cannot read, so the output can be shorter than the
   * input and index-by-index would attach the wrong heading. Matched on the raw text instead,
   * which each parsed line keeps.
   */
  const headings = new Map(lines.map((line) => [line.text.trim(), line.section ?? null]));
  return parsed.map((line) => {
    const section = headings.get(line.raw.trim());
    return section === undefined ? line : { ...line, section };
  });
}
