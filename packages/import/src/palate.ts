import type { LlmProvider, ModelConfig } from "./provider.js";

/**
 * What a child might find difficult in a dish, and why — reasons, never a score.
 *
 * ---------------------------------------------------------------------------
 * Why a model and not a table
 * ---------------------------------------------------------------------------
 *
 * The evidence supports **directional principles only**: children prefer higher sweetness than
 * adults and are more bitter-sensitive, both moderating through adolescence. It also finds
 * preference is shaped by exposure and culture well beyond sensitivity — which is precisely why
 * there is no weighted average by age to encode. A lookup table would have to invent the
 * coefficients the literature does not provide, and would then present them as if measured.
 *
 * So the model reads the ingredients and says what it thinks a child would struggle with, in a
 * sentence a parent can judge. `packages/core` could not do this: it is a judgement about food,
 * not arithmetic on it.
 *
 * ---------------------------------------------------------------------------
 * Why no score
 * ---------------------------------------------------------------------------
 *
 * A number invites trust the evidence does not support. "Kid-friendliness 3/10" is unarguable and
 * unexaminable — nobody can tell whether it is wrong. **"Strong bitter notes from the broccoli
 * rabe; children are more bitter-sensitive than adults" can be judged by the person reading it**,
 * who knows their own child and whether that child eats broccoli rabe quite happily.
 *
 * This is the same rule the taste readings follow: an observation a person can weigh beats a
 * verdict they can only accept or ignore.
 *
 * ---------------------------------------------------------------------------
 * What it is not
 * ---------------------------------------------------------------------------
 *
 * **Never merged with an observation.** "Ada rated this low" is a fact about a child; "children
 * often find this bitter" is a generalisation about children. They answer different questions and
 * are rendered as separate blocks with separate wording — confusing the two is the only real risk
 * here (§57a).
 *
 * The prompt carries recipe content only: ingredients and a title. No name, no ratings, no year
 * of birth. The age band is passed as a word — "younger child", "adolescent" — never a birth year
 * and never an age, so nothing identifying a child reaches an inference provider (CLAUDE.md).
 */
export const PALATE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notes"],
  properties: {
    notes: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ingredient", "reason"],
        properties: {
          ingredient: {
            type: "string",
            description: "the ingredient or element, as the recipe names it",
          },
          reason: {
            type: "string",
            description:
              "one sentence: what a child may find difficult and why. No score, no recommendation.",
          },
        },
      },
    },
  },
} as const;

export const PALATE_INSTRUCTIONS = [
  "You are shown a recipe's title and ingredients. Say what a child might find difficult about it,",
  "and why. At most three things, and only things actually in this recipe.",
  "",
  "What the evidence supports, and the limit of it: children prefer higher sweetness than adults",
  "and are more sensitive to bitterness, and both moderate through adolescence. Preference is also",
  "shaped by exposure and familiarity well beyond taste sensitivity. So write about strong bitter,",
  "sour, spicy, pungent or unfamiliar elements, and about textures children often refuse.",
  "",
  "Give a reason, never a score and never a recommendation. Do not say whether to cook it.",
  "Do not say a child will not eat it — say what about it is demanding, and let the reader judge.",
  "",
  "If nothing in the recipe is likely to be difficult, return an empty list. A plain roast chicken",
  "needs no note, and inventing one would teach the reader to ignore all of them.",
].join(" ");

export interface PalateNote {
  ingredient: string;
  reason: string;
}

/**
 * Which end of the evidence a child sits at, as a word.
 *
 * The literature puts the changeover in sensitivity at mid to late adolescence and does not offer
 * a threshold sharper than that, so this does not pretend to one: three coarse bands, and the
 * boundary years are deliberately vague in the prompt's wording rather than precise in ours.
 *
 * Null when no year of birth is recorded, which is most of the time — the note is still worth
 * having, it just says nothing about age.
 */
export function ageBand(birthYear: number | null, thisYear: number): string | null {
  if (birthYear === null) return null;
  const age = thisYear - birthYear;
  if (age < 0 || age > 25) return null;
  if (age <= 8) return "a younger child";
  if (age <= 13) return "an older child";
  return "an adolescent, for whom these differences are moderating";
}

export async function palateNotes(options: {
  provider: LlmProvider;
  model: ModelConfig;
  recipe: { title: string; ingredients: readonly string[] };
  /** from `ageBand`; omitted entirely when unknown rather than guessed */
  band?: string | null;
}): Promise<PalateNote[]> {
  const { recipe, band } = options;
  const content = [
    recipe.title,
    "",
    "Ingredients:",
    ...recipe.ingredients,
    ...(band ? ["", `This is being considered for ${band}.`] : []),
  ].join("\n");

  const response = await options.provider.extract({
    model: options.model,
    instructions: PALATE_INSTRUCTIONS,
    content,
    responseSchema: PALATE_JSON_SCHEMA,
  });

  const json = response.json as { notes?: unknown } | null;
  if (!Array.isArray(json?.notes)) return [];

  return json.notes
    .filter(
      (note): note is PalateNote =>
        typeof note === "object" &&
        note !== null &&
        typeof (note as PalateNote).ingredient === "string" &&
        typeof (note as PalateNote).reason === "string",
    )
    .map((note) => ({ ingredient: note.ingredient.trim(), reason: note.reason.trim() }))
    .filter((note) => note.ingredient && note.reason)
    .slice(0, 3);
}
