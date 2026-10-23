import type { JsonSchema } from "./provider.js";

/**
 * Reading a shopping list off a photograph — a scrap of paper, not a recipe card.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the recipe extractor with a different prompt
 * ---------------------------------------------------------------------------
 *
 * `EXTRACTION_INSTRUCTIONS` is sixteen sentences about recipe shape: a title, a method, headings,
 * a course, a cuisine. Every one of them pushes toward finding those things, and a handwritten
 * list has none of them. Pointed at a shopping list it would invent a title, read the first item
 * as a heading, and — worst — treat a line with no quantity as an incomplete read.
 *
 * So: its own instructions, its own schema, and its own fingerprint.
 *
 * ---------------------------------------------------------------------------
 * The two things this input has that a recipe card does not
 * ---------------------------------------------------------------------------
 *
 * **A line with no amount is a correct read.** "bread" is the whole line. Most lines will be like
 * that, and nothing here may treat the absence as a failure or fill it in. §54's lesson running
 * the other way: the recipe schema asks for amounts and gets them invented; this one must ask for
 * the line and accept that the quantity is often not on the paper.
 *
 * **People strike through what they already have.** Those lines are *read and marked*, never
 * dropped. A dropped strike-through is invisible — the item simply is not on the list and nothing
 * says it was ever seen — and that is the failure that costs a second trip to the shop. Marked, a
 * misread is visible on the review screen and one tap from being undone.
 */
export const SHOPPING_PHOTO_INSTRUCTIONS = [
  "The image is a shopping list, usually handwritten, on paper or a whiteboard.",
  "Read every line into the given JSON schema, in the order they appear.",
  /*
   * Said in words, not left to the schema. §54: `steps` sat in the recipe schema with a perfectly
   * good description and came back empty from every caption, because eight instructions were
   * about ingredients and none asked for a method. A field nobody asks for in sentences is a
   * field that stays empty.
   */
  "Copy each line verbatim, including any quantity written beside it.",
  "MOST LINES HAVE NO QUANTITY. A line that is only an item name — 'bread', 'milk', 'kitchen",
  "roll' — is a complete and correct reading. Return it as written.",
  "Never add a quantity the paper does not show. Do not write '1' because a line has no number.",
  "There is no title, no method and no servings on a shopping list. Do not look for them.",
  /*
   * The expensive half. A strike-through read as nothing removes an item from somebody's list
   * with no trace, and they find out in the shop.
   */
  "Some lines are crossed out, struck through, or ticked — the person already has that item.",
  "Read those lines too and set struck to true. NEVER leave a crossed-out line out of the list:",
  "an item that silently disappears is worse than one marked wrongly, because nothing shows it.",
  "Set struck to false for an ordinary line, and say how sure you are in strikeConfidence.",
  "If a line is illegible, return what you can make out and set legible to false rather than",
  "guessing a word — a wrong item is bought, an uncertain one is checked.",
  "If the image holds no list at all, return an empty lines array.",
].join("\n");

/**
 * The schema, which is half the prompt (see `prompt-version.ts`).
 *
 * **Every example here demonstrates the answer wanted, never the failure being prevented** —
 * §54a: a component's name example was *itself* the bug, because `"the sauce", "guacamole"` taught
 * role words. So `text`'s example is deliberately a bare item with no quantity, because that is
 * the shape most lines have and an example with "2 lemons" in it would teach quantities onto
 * lines that have none.
 */
export const SHOPPING_PHOTO_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: {
    lines: {
      type: "array",
      description: "Every line on the list, in the order written, crossed-out lines included.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "struck", "strikeConfidence", "legible"],
        properties: {
          text: {
            type: "string",
            description:
              "The line exactly as written, quantity included if one is written. Often just an " +
              "item: 'bread', 'bin bags', 'something for Tuesday'.",
          },
          struck: {
            type: "boolean",
            description:
              "True if the line is crossed out, struck through or ticked — the person already " +
              "has it. False for an ordinary line.",
          },
          strikeConfidence: {
            type: "string",
            enum: ["certain", "unsure"],
            description:
              "How sure you are about struck. 'unsure' for a line with a stray mark through it, " +
              "a line in a different pen, or anything ambiguous.",
          },
          legible: {
            type: "boolean",
            description:
              "False if you could not read the line with confidence and have returned your best " +
              "attempt. True for a line you are sure of.",
          },
        },
      },
    },
  },
};

/** One line as the model read it, before `parseIngredientList` sees the text. */
export interface PhotographedLine {
  text: string;
  struck: boolean;
  strikeConfidence: "certain" | "unsure";
  legible: boolean;
}
