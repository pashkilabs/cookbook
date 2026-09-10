/**
 * The one compatibility judgement with a temperature behind it.
 *
 * ---------------------------------------------------------------------------
 * What is grounded here, and what is not
 * ---------------------------------------------------------------------------
 *
 * Collagen begins unravelling near **60 °C / 140 °F** and needs sustained **70–90 °C /
 * 158–194 °F for hours** to convert to gelatin (§60). That is physical chemistry, and it grounds
 * exactly one claim: *a collagen-rich cut given minutes rather than hours stays tough.* It does
 * not ground "do these two things go together", which nothing in the literature grounds
 * (§60 rejects compound-sharing outright).
 *
 * So this module answers a narrow question loudly and refuses every wider one. Everything below
 * is about staying silent.
 *
 * ---------------------------------------------------------------------------
 * Time comes from the steps, not from `time_minutes`
 * ---------------------------------------------------------------------------
 *
 * Two reasons, and the first was measured rather than assumed.
 *
 * **`time_minutes` is wrong in the direction that fires the warning.** In the production corpus
 * it is prep-only often enough to matter: "GUINNESS SMOKED BABY BACK RIBS" stores **20** while
 * its steps say two hours, and "Braised Short Ribs" stores **null** while its steps say three.
 * A rule reading the column would have announced that a rib recipe needs longer cooking to a
 * cook already smoking it for two hours — the worst kind of warning, confidently wrong about
 * the thing the reader can see with their own eyes.
 *
 * **And a total is not the mechanism's quantity anyway.** Collagen wants one *sustained*
 * interval; five minutes plus ten plus fifteen is not half an hour of anything. So this reads
 * the longest single interval any step names and ignores their sum.
 *
 * ---------------------------------------------------------------------------
 * Every ambiguity resolves toward silence
 * ---------------------------------------------------------------------------
 *
 * A warning is more forceful than a display, so it carries the burden of proof:
 *
 *   - a range takes its **upper** bound — "2–3 hours" is three, so a borderline recipe passes
 *   - no duration named at all is **not measurable**, and an unmeasurable check must never
 *     look like a passed one, so it returns nothing rather than firing
 *   - pressure silences it: 45 minutes under pressure does the work of hours at atmospheric,
 *     and the module cannot model that, so it declines to speak
 *   - poultry is absent from the table on purpose. Thigh and leg carry more collagen than
 *     breast and are *also* perfectly good cooked fast, so they would be nothing but noise.
 *
 * ---------------------------------------------------------------------------
 * What was measured, and the denominator that matters
 * ---------------------------------------------------------------------------
 *
 * Against the 68 recipes in production it fires on **none**. But 65 of them could never have
 * fired — they carry no collagen-rich cut at all — so the honest denominator is **three**, and
 * "no false positives in three" is a weak claim stated plainly rather than a strong one stated
 * as 0/68. A control confirms the zero is a result and not a broken probe: chuck dropped into a
 * six-minute stir-fry fires.
 *
 * Those three are also the evidence for reading the steps. "GUINNESS SMOKED BABY BACK RIBS"
 * stores `time_minutes = 20`; its steps reach hours. A column-reading rule fires on it. This one
 * does not.
 *
 * It cannot show a true positive here at all, because the corpus contains no recipe that gets
 * this wrong — real published recipes braise their chuck. The case it exists for is a *blend*,
 * which is the only way chuck ever meets a twenty-minute method, and blends do not exist yet.
 * So the true positives are constructed in tests, and that is a stated limit rather than a
 * hidden one.
 *
 * **Known false negative, kept deliberately.** "Marinate overnight" counts as a long interval,
 * so a marinade silences the warning for the dish it marinates — measured on the rib recipe,
 * whose 480 minutes are a marinade rather than a cook. Distinguishing them needs the technique
 * extraction §60 removed from the sequence for want of a corpus. The error runs toward silence,
 * which is the direction to be wrong in, and it is recorded here rather than left to be
 * rediscovered.
 */

/**
 * Cuts whose toughness is connective tissue rather than muscle fibre.
 *
 * Locomotor and weight-bearing muscles — shoulder, shin, neck, tail — do work and are rich in
 * collagen; loin muscles support rather than move and are not. Multi-word wherever the single
 * word is ambiguous in an ingredient line: bare "round" is a shape and bare "blade" is a knife.
 */
export const COLLAGEN_RICH_CUTS: readonly string[] = [
  "chuck",
  "brisket",
  "oxtail",
  "ox tail",
  "short rib",
  "spare rib",
  "beef shin",
  "veal shin",
  "osso buco",
  "shank",
  "pork shoulder",
  "lamb shoulder",
  "beef shoulder",
  "goat shoulder",
  "veal shoulder",
  "pork belly",
  "beef cheek",
  "ox cheek",
  "pork cheek",
  "stewing beef",
  "stewing steak",
  "stew meat",
  "blade steak",
  "blade roast",
  "boston butt",
  "pork butt",
  "lamb neck",
  "neck of lamb",
  "pig trotter",
  "ham hock",
  "pork hock",
];

/** Words that mean the module cannot reason about the temperature, so it says nothing. */
const PRESSURE = ["pressure cook", "pressure-cook", "instant pot", "instantpot", "pressure cooker"];

/**
 * The cut named in an ingredient line, or null.
 *
 * Word-boundary matching, because substring matching is how "onion powder" became "onion" in the
 * shopping list — a conflation that reads as confident and is wrong.
 */
export function collagenRichCut(line: string): string | null {
  const text = line.toLowerCase();
  for (const cut of COLLAGEN_RICH_CUTS) {
    const at = text.indexOf(cut);
    if (at === -1) continue;
    const before = at === 0 ? " " : text[at - 1]!;
    const after = at + cut.length >= text.length ? " " : text[at + cut.length]!;
    // trailing "s" is the plural, not a different word: "short ribs" is "short rib"
    if (/[a-z]/.test(before)) continue;
    if (/[a-z]/.test(after) && after !== "s") continue;
    return cut;
  }
  return null;
}

const UNITS: ReadonlyArray<[RegExp, number]> = [
  [/hours?|hrs?\b/, 60],
  [/minutes?|mins?\b/, 1],
];

/**
 * The longest single interval any step names, in minutes — null when no step names one.
 *
 * Ranges take their upper bound, and "overnight" is treated as long, because both choices push
 * toward saying nothing. Null is a third outcome and not a zero: a recipe whose steps carry no
 * duration has not been measured, and measuring nothing must not read as measuring a short time.
 */
export function longestSustainedMinutes(steps: readonly string[]): number | null {
  let longest: number | null = null;
  const note = (minutes: number) => {
    if (longest === null || minutes > longest) longest = minutes;
  };

  for (const step of steps) {
    const text = step.toLowerCase();
    if (/overnight|8 hours or|all day/.test(text)) note(8 * 60);

    // "3-5 hours", "2 to 3 hours", "90 minutes", "1 hour 30 minutes"
    const pattern = /(\d+(?:\.\d+)?)\s*(?:(?:[-–—]|\s+to\s+)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?)\b/g;
    for (const match of text.matchAll(pattern)) {
      const upper = Number(match[2] ?? match[1]);
      if (!Number.isFinite(upper)) continue;
      const unit = UNITS.find(([test]) => test.test(match[3]!));
      if (!unit) continue;
      note(upper * unit[1]);
    }
  }
  return longest;
}

export interface CompatibilityWarning {
  /** what stands behind it — never mixed with a model's own judgement (§57a) */
  basis: "mechanism";
  /** the ingredient line it is about, as the recipe names it */
  subject: string;
  /** one sentence a cook can weigh. No score, no verdict, no instruction to change anything. */
  note: string;
}

/**
 * Fires only when a collagen-rich cut meets a measured interval too short to convert it.
 *
 * 90 minutes rather than a tighter number: conversion is well under way by two hours and barely
 * begun at one, and the gap between them is where a rule would be arguing with cooks about
 * their own dinner. Below ninety it is not a matter of degree — nothing has happened yet.
 */
export const SUSTAINED_MINUTES_NEEDED = 90;

export function collagenWarnings(recipe: {
  ingredients: readonly string[];
  steps: readonly string[];
}): CompatibilityWarning[] {
  if (recipe.steps.some((step) => PRESSURE.some((word) => step.toLowerCase().includes(word)))) {
    return [];
  }

  const longest = longestSustainedMinutes(recipe.steps);
  // not measurable is not "short" — the commonest reason to say nothing at all
  if (longest === null || longest >= SUSTAINED_MINUTES_NEEDED) return [];

  const warnings: CompatibilityWarning[] = [];
  for (const line of recipe.ingredients) {
    const cut = collagenRichCut(line);
    if (!cut) continue;
    warnings.push({
      basis: "mechanism",
      subject: line,
      note:
        `${cut} is tough with connective tissue rather than muscle, and collagen needs hours ` +
        `held around 70–90 °C to become gelatin. The longest step here is ${describe(longest)}, ` +
        `which will not get there.`,
    });
  }
  return warnings;
}

const describe = (minutes: number) =>
  minutes >= 60
    ? `${Math.round((minutes / 60) * 10) / 10} hours`.replace("1 hours", "1 hour")
    : `${minutes} minutes`;
