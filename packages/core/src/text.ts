/** Descriptors that identify preparation rather than the ingredient itself. */
const PREP_WORDS = [
  "fresh", "freshly", "chopped", "minced", "diced", "sliced", "grated",
  "shredded", "ground", "boneless", "skinless", "large", "small", "medium",
  "ripe", "cooked", "raw", "thinly", "roughly", "finely", "packed",
  "softened", "melted", "room temperature", "cold", "warm", "optional",
  "to taste", "plus more", "divided", "for serving", "for garnish",
  "uncooked", "peeled", "trimmed", "rinsed", "drained", "halved", "quartered",
  // states rather than products: the catalog has one basil and one pasta, so "dried basil" and
  // "dry orecchiette pasta" should reach them rather than fall off the list entirely
  "dry", "dried",
];

const PREP_RE = new RegExp(`\\b(${PREP_WORDS.join("|")})\\b`, "g");

/**
 * The same words, as single tokens, for deciding whether what is left over after a catalog
 * match is preparation or a different product. See `catalog.ts`.
 */
export const PREP_TOKENS: ReadonlySet<string> = new Set(
  PREP_WORDS.flatMap((word) => word.split(" ")),
);

/**
 * Aggressive normalisation: strips preparation words, so "finely diced onion"
 * and "1 onion, chopped" collapse to the same thing for grouping.
 */
export function normaliseName(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/,.*$/, "")
    .replace(PREP_RE, " ")
    .replace(/[^a-z0-9&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Gentle normalisation: keeps every word. Needed because some preparation
 * words are load-bearing — "diced tomatoes" is a tin, "tomatoes" is fresh
 * produce, and stripping "diced" merges two different products.
 */
export function lightName(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/,.*$/, "")
    .replace(/[^a-z0-9&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** a numeric entity's character, or the entity left alone when it is not printable text */
function codePoint(code: number, whole: string): string {
  if (!Number.isFinite(code)) return whole;
  // C0/C1 controls and anything past the Unicode range are not text a recipe should carry
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code > 0x10ffff) return " ";
  return String.fromCodePoint(code);
}

export function stripTags(input: string): string {
  return String(input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&apos;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&frac12;/gi, "½")
    .replace(/&frac14;/gi, "¼")
    .replace(/&frac34;/gi, "¾")
    .replace(/&deg;/gi, "°")
    /*
     * Numeric entities become their character, not a space.
     *
     * regression: the named list above catches `&#39;` and the catch-all below turned everything
     * else into whitespace — so `Kroll&#039;s Korner`, the same apostrophe written with a leading
     * zero, came out as `Kroll s Korner`. A publisher choosing a zero-padded entity is not
     * writing a different character, and a space is never the right reading of one.
     *
     * Decimal and hex both, and only in the ranges that are text: a control character decoded
     * into a recipe title would be invisible damage of exactly the kind U+FFFD already caused in
     * the fixtures.
     */
    .replace(/&#(\d+);/g, (whole, code) => codePoint(Number(code), whole))
    .replace(/&#x([0-9a-f]+);/gi, (whole, code) => codePoint(parseInt(code, 16), whole))
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Seasonings assumed to be in the cupboard already. */
export const STAPLES = [
  "salt", "kosher salt", "sea salt", "table salt", "flaky salt", "flaky sea salt",
  "pepper", "black pepper", "white pepper", "ground black pepper",
  "water", "ice", "ice water", "cooking spray", "olive oil spray",
  /*
   * The oils are listed one by one on purpose. `"oil"` plus a suffix match used to make *every*
   * `X oil` a staple, which is right for olive oil and wrong for sesame, chilli and truffle oil
   * — things you buy. Naming them costs a line and an unfamiliar oil now errs toward the
   * shopping list, which is the visible direction.
   */
  "oil", "olive oil", "vegetable oil", "canola oil", "neutral oil", "sunflower oil",
  "rapeseed oil", "avocado oil", "grapeseed oil",
];

/**
 * Words that describe a staple without changing what it is.
 *
 * The old rule matched a staple anywhere in the name — `n.startsWith(s + " ")` or
 * `n.endsWith(" " + s)` — which is right for "freshly ground black pepper" and catastrophic for
 * everything where the qualifier IS the identity. It classified **bell pepper, green pepper,
 * sweet pepper, red pepper, jalapeno pepper and poblano pepper** as cupboard seasonings, so a
 * recipe calling for one never reached the shopping list; `bell peppers` survived only because
 * the plural does not end in " pepper", and catalog names are stored **singular**, so the
 * canonical form was the broken one. It also swallowed **salt pork** (a meat), **truffle oil**
 * and **sesame oil** (both bought), and **garlic salt** and **celery salt**.
 *
 * So the match is now anchored: an exact staple, or a staple behind these modifiers and nothing
 * else. An allow-list rather than a list of exceptions, deliberately, because the two failure
 * directions are not equal. A missed modifier tells somebody to buy salt — visible, mildly
 * annoying, and they ignore it. A missed exception silently omits an ingredient from the
 * shopping list, which is the invisible direction, and this codebase has paid for that shape
 * enough times to choose against it.
 */
const STAPLE_MODIFIERS = new Set([
  "freshly", "fresh", "ground", "coarse", "coarsely", "fine", "finely", "cracked", "flaked",
  "extra", "virgin", "pure", "light", "cold", "pressed", "filtered", "warm", "hot", "boiling",
  "iced", "chilled", "plain", "good", "quality", "plus", "more", "optional",
]);

export function isStaple(name: string): boolean {
  // hyphens, because a catalog key is "olive-oil" and `normaliseName` gives "olive oil"; both
  // reach this function and a rule written for one of them silently fails for the other
  const n = normaliseName(name).replace(/-/g, " ").trim();
  if (!n) return false;

  // "salt and pepper" is two staples, not an ingredient — and so is "kosher salt and black pepper"
  const joined = n.split(/\s+(?:and|&|\+)\s+/);
  if (joined.length > 1) return joined.every((part) => isStaple(part));

  if (STAPLES.includes(n)) return true;

  /*
   * Strip leading modifiers and ask again. **Leading only.** A word after the staple changes the
   * noun — salt pork is a meat, pepper jack is a cheese — while a word before it almost always
   * describes the same thing: coarse sea salt, extra virgin olive oil, freshly ground pepper.
   */
  const words = n.split(" ");
  let at = 0;
  while (at < words.length && STAPLE_MODIFIERS.has(words[at]!)) at += 1;
  return at > 0 && STAPLES.includes(words.slice(at).join(" "));
}

const VULGAR_FRACTIONS: Record<string, string> = {
  "½": " 1/2", "⅓": " 1/3", "⅔": " 2/3", "¼": " 1/4", "¾": " 3/4",
  "⅕": " 1/5", "⅖": " 2/5", "⅗": " 3/5", "⅘": " 4/5", "⅙": " 1/6",
  "⅚": " 5/6", "⅛": " 1/8", "⅜": " 3/8", "⅝": " 5/8", "⅞": " 7/8",
  "⅐": " 1/7", "⅑": " 1/9", "⅒": " 1/10",
};

/** Rewrite "1½" as "1 1/2" so a single number pattern can read it. */
export function expandFractions(input: string): string {
  let out = String(input ?? "");
  for (const [glyph, plain] of Object.entries(VULGAR_FRACTIONS)) {
    if (out.includes(glyph)) out = out.split(glyph).join(plain);
  }
  return out.replace(/(\d)\s*-\s*(\d+\/\d+)/g, "$1 $2").replace(/\s+/g, " ").trim();
}

/** Read "1 1/2", "3/4", "2.5" or "1,5" as a number. */
export function readNumber(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = input.trim().replace(",", ".");
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(s);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const GLYPH_FOR: Array<[number, string]> = [
  [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.375, "⅜"], [0.5, "½"],
  [0.625, "⅝"], [2 / 3, "⅔"], [0.75, "¾"], [0.875, "⅞"],
];

/** Cook-readable numbers: 1.5 -> "1½", 0.25 -> "¼". */
export function formatQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  if (value < 0) return `-${formatQuantity(-value)}`;
  const whole = Math.floor(value + 1e-9);
  const fraction = value - whole;
  if (fraction >= 0.93) return String(whole + 1);

  let glyph = "";
  let closest = 0.07;
  for (const [amount, symbol] of GLYPH_FOR) {
    const diff = Math.abs(fraction - amount);
    if (diff < closest) {
      closest = diff;
      glyph = symbol;
    }
  }
  if (!glyph && fraction > 0.07) return String(Math.round(value * 100) / 100);
  if (whole === 0) return glyph || "0";
  return `${whole}${glyph}`;
}
