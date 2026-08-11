/** Descriptors that identify preparation rather than the ingredient itself. */
const PREP_WORDS = [
  "fresh", "freshly", "chopped", "minced", "diced", "sliced", "grated",
  "shredded", "ground", "boneless", "skinless", "large", "small", "medium",
  "ripe", "cooked", "raw", "thinly", "roughly", "finely", "packed",
  "softened", "melted", "room temperature", "cold", "warm", "optional",
  "to taste", "plus more", "divided", "for serving", "for garnish",
  "uncooked", "peeled", "trimmed", "rinsed", "drained", "halved", "quartered",
];

const PREP_RE = new RegExp(`\\b(${PREP_WORDS.join("|")})\\b`, "g");

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
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Seasonings assumed to be in the cupboard already. */
export const STAPLES = [
  "salt", "kosher salt", "sea salt", "table salt", "flaky salt",
  "pepper", "black pepper", "white pepper", "ground black pepper",
  "water", "ice", "ice water", "cooking spray", "olive oil spray",
  "vegetable oil", "canola oil", "neutral oil", "oil",
];

export function isStaple(name: string): boolean {
  const n = normaliseName(name);
  if (!n) return false;
  return STAPLES.some((s) => n === s || n.startsWith(`${s} `) || n.endsWith(` ${s}`));
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
