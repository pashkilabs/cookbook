/**
 * What the method should contain, for the four caption formats that exposed the gap.
 *
 * ---------------------------------------------------------------------------
 * What "correct" means for a step
 * ---------------------------------------------------------------------------
 *
 * **Presence and order on distinctive fragments**, not exact text.
 *
 * Exact text fails for the wrong reason. `"Melt 2 tb of butter in a large pan over medium heat."`
 * and `"Melt 2 tb butter in a large pan over medium heat"` differ by a word and a full stop and
 * are the same step. A scorer that calls that a miss reports regressions that are not real, and
 * the response to a noisy metric is to stop trusting it — which is worse than no metric.
 *
 * So each expectation is a short fragment that **identifies** its step: the verb and its object,
 * chosen to appear in no other step of the same recipe. A step matches if some returned step
 * contains it once both are normalised — case, punctuation, whitespace, leading decoration.
 *
 * **Order counts.** A fragment may only match at or after the index where the previous fragment
 * matched, so a method returned shuffled scores lower than one returned in sequence. You cannot
 * fold the burrito before you cook the chicken; sequence is part of a method being right.
 *
 * **Two things this deliberately does not measure.** Extra steps, because a ten-step method
 * returned as eleven is a different split rather than a wrong answer. And wording, because that
 * is what the review screen is for.
 *
 * ---------------------------------------------------------------------------
 * Why these four
 * ---------------------------------------------------------------------------
 *
 * They are the four step *formats*, which is what the extractor was blind to — all four returned
 * `steps: []` while the prompt asked only for ingredients. One numbered under a heading, one
 * marked with an emoji, two with no marker at all. Four scored is enough to stop this
 * regressing, and an unscored field is an unrun test (CLAUDE.md).
 *
 * Fragments are hand-checked against the caption text, not generated from a previous run —
 * a fixture written from the output it is meant to judge measures nothing.
 */
export interface CaptionStepExpectation {
  /** the file under eval/intake/captions, without .txt */
  fixture: string;
  /** how the source marks its steps — the property under test */
  format: string;
  /** one identifying fragment per step, in the order the method runs */
  fragments: string[];
}

export const CAPTION_STEP_EXPECTATIONS: CaptionStepExpectation[] = [
  {
    fixture: "instagram-cinnamon-rolls",
    format: "DIRECTIONS: heading, numbered 1)–6)",
    fragments: [
      "stand for 10 minutes",
      "until a dough forms",
      "heat your oven to 175",
      "pizza cutter",
      "heavy cream to each",
      "food processor",
    ],
  },
  {
    fixture: "caption-cornflake-chicken-wrap",
    format: "every step prefixed with an emoji, no heading",
    fragments: [
      "seasoning the chicken breast",
      "dip into the egg white",
      "air fry for 17 minutes",
      "mayo and chilli puree",
      "honey and hot sauce",
      "drizzle over the hot honey",
      "microwave the wraps",
      "pan fry seams down",
      "garnish with chilli flakes",
    ],
  },
  {
    fixture: "instagram-lemony-shrimp-orzo",
    format: "no marker — one prose paragraph after the ingredients",
    fragments: [
      "melt 2 tb of butter",
      "until the shrimp is cooked through",
      "remove the shrimp from the pan",
      "shallots and garlic",
      "broth, wine, orzo",
      "reduce heat to medium-low",
      "stir in the cheese",
      "shrimp back to the pan",
      "serve and enjoy",
    ],
  },
  {
    fixture: "instagram-marry-me-sausage-soup",
    format: "no marker — one prose paragraph after the ingredients",
    fragments: [
      "slice the sundried tomatoes",
      "chop the onion",
      "oil from the sundried tomato jar",
      "add the sausage",
      "mash into smaller pieces",
      "veggies have softened",
      "chicken broth",
      "add in the pasta",
      "heavy cream, spinach",
      "stir in the parmesan",
      "divide into bowls",
    ],
  },
];

/** case, punctuation and leading decoration removed, so a full stop is not a miss */
const normalise = (text: string) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export interface StepScore {
  matched: number;
  expected: number;
  /** fragments that never appeared, so a failure names what is missing rather than a number */
  missing: string[];
  /** steps the model returned, for the record — extra ones are not penalised */
  returned: number;
}

/**
 * Score returned steps against the expected fragments, in order.
 *
 * The cursor only moves forward: once `"add the sausage"` matches at index 3, the next fragment
 * is sought from index 3 onward. A correct method in the wrong order therefore scores below one
 * in the right order, without needing a separate order metric.
 */
export function scoreSteps(fragments: readonly string[], steps: readonly string[]): StepScore {
  const haystack = steps.map(normalise);
  const missing: string[] = [];
  let cursor = 0;
  let matched = 0;

  for (const fragment of fragments) {
    const needle = normalise(fragment);
    const at = haystack.findIndex((step, index) => index >= cursor && step.includes(needle));
    if (at === -1) {
      missing.push(fragment);
      continue;
    }
    matched += 1;
    cursor = at;
  }

  return { matched, expected: fragments.length, missing, returned: steps.length };
}

/**
 * What a caption's course and cuisine should come back as.
 *
 * **Null is scored separately from wrong**, because they are different failures and the prompt
 * moves in opposite directions for each. A model declining on an obvious main needs *less*
 * caution; a model calling a soup a snack needs *more*. One number averaging them would move the
 * prompt one way while the other error got worse, and nothing would show it.
 *
 * **Course accepts a set, not a value.** Cinnamon rolls are genuinely breakfast and genuinely
 * dessert; forcing one would measure my opinion rather than the model's accuracy. The set is
 * small and hand-chosen — it is not a licence for a vague answer.
 *
 * **Cuisine is exact after normalisation, with an alias map for genuine variants.** Casing and
 * hyphenation are noise; `italian-american` and `italian` are the same answer for a filter,
 * because someone filtering Italian wants that soup. A *broader* answer is a miss, not a match:
 * "Asian" for a Thai dish is a worse answer rather than an equivalent one, and scoring it as a
 * pass would let the field decay into uselessness while the number stayed green.
 */
export interface CaptionClassExpectation {
  fixture: string;
  /** every course that would be a correct answer; empty means the source does not say */
  course: string[];
  /** null where the text does not say and the dish is not unmistakable */
  cuisine: string | null;
  why?: string;
}

export const CAPTION_CLASS_EXPECTATIONS: CaptionClassExpectation[] = [
  { fixture: "instagram-cinnamon-rolls", course: ["dessert", "breakfast"], cuisine: null,
    why: "genuinely both; the caption names no cuisine" },
  { fixture: "caption-cornflake-chicken-wrap", course: ["main"], cuisine: null,
    why: "a chicken wrap with a method and a calorie count is a main by any reading" },
  { fixture: "instagram-lemony-shrimp-orzo", course: ["main"], cuisine: null,
    why: "orzo alone does not make it Italian — the prompt's own rule" },
  { fixture: "instagram-marry-me-sausage-soup", course: ["main"], cuisine: "italian",
    why: "the title says Italian; a soup with pasta and 6 cups of broth is not a snack" },
  { fixture: "instagram-peach-posset", course: ["dessert"], cuisine: null,
    why: "a posset is British, but the caption does not say so and the rule is not to guess" },
  { fixture: "facebook-chicken-pad-thai", course: ["main"], cuisine: "thai" },
];

/** genuine variants of one answer, not broader categories */
const CUISINE_ALIASES: Record<string, string> = {
  "italian-american": "italian",
  "italian american": "italian",
  "tex-mex": "mexican",
  "tex mex": "mexican",
  american: "american",
  british: "british",
};

export const normaliseCuisine = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase().replace(/[^a-z\s-]/g, "").replace(/\s+/g, " ").trim();
  if (!key) return null;
  return CUISINE_ALIASES[key] ?? key;
};

export type ClassVerdict = "right" | "declined" | "wrong";

/** three outcomes, never two: a decline and a wrong answer are different news */
export function scoreCourse(expected: readonly string[], actual: unknown): ClassVerdict {
  if (actual === null || actual === undefined || actual === "") return "declined";
  return expected.includes(String(actual)) ? "right" : "wrong";
}

export function scoreCuisine(expected: string | null, actual: unknown): ClassVerdict {
  const got = normaliseCuisine(typeof actual === "string" ? actual : null);
  // where the source says nothing, declining IS the right answer and naming one is wrong
  if (expected === null) return got === null ? "right" : "wrong";
  if (got === null) return "declined";
  return got === expected ? "right" : "wrong";
}
