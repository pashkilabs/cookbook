import type { ImageInput, LlmProvider, ModelConfig } from "./provider.js";

/**
 * Which way up is the card?
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 *
 * EXIF cannot answer it. A phone photographed a recipe card lying sideways on a table: the
 * *camera* was upright, so EXIF says upright, and the *writing* runs bottom-to-top. `sharp()
 * .rotate()` honours EXIF faithfully and changes nothing, because there is nothing in the file
 * to honour. The only thing that knows which way the letters run is something that can read
 * letters.
 *
 * ---------------------------------------------------------------------------
 * Why a forced choice among four, and not "which way does this run?"
 * ---------------------------------------------------------------------------
 *
 * The obvious design — one image, "report the rotation that makes this readable" — **does not
 * work, and fails in the worst available way.** Measured on the overton pair, eight probes
 * returned eight `confident: true` and two correct answers:
 *
 *     front @0°   → rotate:0,  "I can clearly read 'Baked Eggplant Parmesan'"
 *     front @180° → rotate:90, "Recipe Garden Balls, scoop out a ball of dough…"
 *     back  @180° → rotate:90, "'Puff pastry, well-chilled sliced', 'aged cheddar'"
 *
 * None of those words are on the card. A model that cannot read sideways writing **invents
 * readable writing and reports the rotation that fits the invention**, and asking it for a
 * confidence flag only gets the confabulation to vouch for itself. There is no ambiguity signal
 * to branch on, because it is never uncertain.
 *
 * Showing all four rotations at once removes the escape route: a confabulation is equally
 * available at every rotation, so it cannot discriminate between them, and the model has to
 * fall back on the only thing that does — the letters. `firstLine` is not decoration; it makes
 * the answer prove itself, and it is what turns a guess into something a human can check.
 * Measured 12/12 across the overton pair and a card that was already upright, at all four
 * presentations.
 *
 * ---------------------------------------------------------------------------
 * What it is for, which changed
 * ---------------------------------------------------------------------------
 *
 * It began as protection against invention: Haiku, given the card sideways, returned
 * `"Peppermint Candy Fudge"` — schema-valid, fluent, and nothing to do with a recipe for bread
 * rolls. Then Sonnet turned out to read the same card sideways and get it substantially right.
 *
 * That does not retire the probe, it **re-aims** it. Sonnet sideways drops the numbers it cannot
 * resolve: `c. milk` for `2 c. milk`, bare `flour` for `6 c. flour`. A blank amount is honest and
 * still wrong, and a review screen showing a blank invites someone to accept it. So the probe now
 * buys completeness rather than safety — a weaker claim, and still worth roughly 1,600 tokens
 * against a 448px thumbnail, which is cheap enough to run unconditionally rather than on
 * suspicion. There is no reliable way to suspect: the failure is silent by construction.
 */
export const ORIENTATIONS = [0, 90, 180, 270] as const;

export type Orientation = (typeof ORIENTATIONS)[number];

export const ORIENTATION_INSTRUCTIONS = [
  "You are shown the SAME photograph four times, at four different rotations.",
  "They are given in order: image 1, image 2, image 3, image 4.",
  "Exactly one of them has the writing the right way up. Say which.",
  "",
  "Judge only by the letters and the lines of text.",
  "Ignore the shape of the paper, the border, the decoration and any printed frame —",
  "a card can be photographed sideways inside a border that looks upright.",
  "",
  "Then transcribe the first line of writing in the one you chose, exactly as written,",
  "to show that you could read it. If none of the four is readable, say so in firstLine",
  "and choose the one that is closest.",
].join("\n");

export const ORIENTATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["upright", "firstLine"],
  properties: {
    upright: {
      type: "integer",
      enum: [1, 2, 3, 4],
      description: "which of the four images has the writing the right way up",
    },
    firstLine: {
      type: "string",
      description: "the first line of writing in the chosen image, exactly as written",
    },
  },
} as const;

export interface OrientationReading {
  /** clockwise degrees to add to the original so the writing reads normally */
  rotate: Orientation;
  /** what it read, which is the evidence that it read anything */
  firstLine: string;
}

/**
 * Ask which of four rotations is upright. `rotations` must be the same image at
 * `ORIENTATIONS[0..3]`, in that order — the caller renders them, because rendering needs an
 * image library and this package stays free of one at module scope.
 *
 * Returns null when the model does not answer the shape, so the caller proceeds unrotated
 * rather than failing an import over a hint.
 */
export async function detectOrientation(options: {
  provider: LlmProvider;
  model: ModelConfig;
  rotations: ImageInput[];
}): Promise<OrientationReading | null> {
  const { provider, model, rotations } = options;
  if (rotations.length !== ORIENTATIONS.length) {
    throw new Error(`orientation needs ${ORIENTATIONS.length} rotations, got ${rotations.length}`);
  }

  const response = await provider.extract({
    model,
    instructions: ORIENTATION_INSTRUCTIONS,
    content: "Which of these four has the writing the right way up?",
    images: rotations,
    responseSchema: ORIENTATION_JSON_SCHEMA,
  });

  const json = response.json as { upright?: unknown; firstLine?: unknown } | null;
  const upright = typeof json?.upright === "number" ? json.upright : null;
  if (upright === null || !Number.isInteger(upright) || upright < 1 || upright > 4) return null;

  return {
    rotate: ORIENTATIONS[upright - 1] as Orientation,
    firstLine: typeof json?.firstLine === "string" ? json.firstLine : "",
  };
}
