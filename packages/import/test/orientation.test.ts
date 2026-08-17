import { describe, expect, it } from "vitest";
import { detectOrientation, ORIENTATIONS } from "../src/orientation.js";
import type { ImageInput, LlmProvider, ModelConfig } from "../src/provider.js";

const MODEL: ModelConfig = { provider: "anthropic", model: "claude-haiku-4-5", region: "us" };
const four = (): ImageInput[] =>
  ORIENTATIONS.map(() => ({ bytes: new Uint8Array([1]), mediaType: "image/jpeg" as const }));

const answering = (json: unknown): LlmProvider & { seen: { images: number } } => {
  const seen = { images: 0 };
  return {
    key: "fake",
    seen,
    async extract(request) {
      seen.images = request.images?.length ?? 0;
      return { json, usage: { model: MODEL.model } };
    },
  };
};

describe("which way up the card is", () => {
  it("turns the chosen image's index into degrees clockwise", async () => {
    for (const [index, degrees] of ORIENTATIONS.entries()) {
      const reading = await detectOrientation({
        provider: answering({ upright: index + 1, firstLine: "Recipe Grandma Overtons Rolls" }),
        model: MODEL,
        rotations: four(),
      });
      expect(reading?.rotate).toBe(degrees);
    }
  });

  it("carries what it read, which is the evidence it read anything", async () => {
    const reading = await detectOrientation({
      provider: answering({ upright: 1, firstLine: "Scald 2 c. milk" }),
      model: MODEL,
      rotations: four(),
    });
    expect(reading?.firstLine).toBe("Scald 2 c. milk");
  });

  it("shows the model all four at once, which is what stops it confabulating", async () => {
    const provider = answering({ upright: 1, firstLine: "x" });
    await detectOrientation({ provider, model: MODEL, rotations: four() });
    expect(provider.seen.images).toBe(4);
  });

  it("returns null rather than guessing when the answer is out of range", async () => {
    for (const bad of [{ upright: 0 }, { upright: 5 }, { upright: "1" }, {}, null]) {
      const reading = await detectOrientation({
        provider: answering(bad),
        model: MODEL,
        rotations: four(),
      });
      expect(reading).toBeNull();
    }
  });

  it("refuses to ask about anything but four rotations", async () => {
    await expect(
      detectOrientation({ provider: answering({}), model: MODEL, rotations: four().slice(0, 3) }),
    ).rejects.toThrow(/needs 4 rotations/);
  });
});
