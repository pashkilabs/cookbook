import { randomFillSync } from "node:crypto";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_LIMITS, decodeImage } from "../src/index.js";
import { createSharpImagePreparer } from "../src/sharp-preparer.js";

/**
 * The real preparer. Worth testing rather than trusting: "downscale before sending"
 * is a cost claim, and a passthrough that silently forwarded a 4000px screenshot
 * would satisfy the type signature while costing money on every import.
 */
const preparer = createSharpImagePreparer();

/** A tall PNG screenshot with a regular pattern — cheap to build, compresses very well. */
async function screenshot(width: number, height: number): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7919) % 256;
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return new Uint8Array(png);
}

/**
 * A PNG of content PNG cannot compress, which is what a screenshot of food actually
 * is. Needed because byte reduction depends on content: the regular pattern above
 * compresses to under 100 KB as PNG, and re-encoding it as JPEG makes it *larger*.
 */
async function photographicScreenshot(width: number, height: number): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height * 3);
  randomFillSync(pixels);
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return new Uint8Array(png);
}

describe("downscaling before sending", () => {
  let full: Uint8Array;

  beforeAll(async () => {
    full = await screenshot(1290, 2796); // an iPhone screenshot, roughly
  });

  it("brings a full-size screenshot inside the limits", async () => {
    const result = await preparer.prepare([{ bytes: full, label: "shot.png" }]);
    expect(result.rejected).toEqual([]);
    const image = result.images[0]!;
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(
      DEFAULT_IMAGE_LIMITS.maxDimension,
    );
    expect(image.bytes.byteLength).toBeLessThanOrEqual(DEFAULT_IMAGE_LIMITS.maxBytes);
    expect(image.downscaled).toBe(true);
  });

  it("sends far fewer pixels than it was given", async () => {
    // the guaranteed saving, and the one that matters: pixels above a model's tile
    // ceiling are paid for and then discarded
    const result = await preparer.prepare([{ bytes: full }]);
    const image = result.images[0]!;
    expect(image.width * image.height).toBeLessThan(0.4 * 1290 * 2796);
  });

  it("sends fewer bytes for content that is actually photographic", async () => {
    // Byte reduction is content-dependent, not guaranteed: a small, highly regular
    // PNG can re-encode to a *larger* JPEG. What is guaranteed is the dimension and
    // byte ceilings above. This is the realistic case — a screenshot of food is
    // photographic, which is the worst case for PNG.
    const photo = await photographicScreenshot(1290, 2796);
    const result = await preparer.prepare([{ bytes: photo }]);
    expect(result.images[0]!.bytes.byteLength).toBeLessThan(photo.byteLength);
  });

  it("keeps the aspect ratio", async () => {
    const result = await preparer.prepare([{ bytes: full }]);
    const image = result.images[0]!;
    expect(image.width / image.height).toBeCloseTo(1290 / 2796, 2);
  });

  it("re-encodes as JPEG, which a screenshot of food should be", async () => {
    const result = await preparer.prepare([{ bytes: full }]);
    expect(result.images[0]!.mediaType).toBe("image/jpeg");
    // and the bytes really are a JPEG, decoded rather than declared
    expect(decodeImage(result.images[0]!.bytes)?.format).toBe("jpeg");
  });

  it("does not enlarge a small crop", async () => {
    // upscaling a caption crop would cost more and read worse
    const small = await screenshot(400, 200);
    const result = await preparer.prepare([{ bytes: small }]);
    const image = result.images[0]!;
    expect([image.width, image.height]).toEqual([400, 200]);
    expect(image.downscaled).toBe(false);
  });

  it("rejects bytes that are not an image, with the reason", async () => {
    const result = await preparer.prepare([
      { bytes: new TextEncoder().encode("<html>404</html>"), label: "error.jpg" },
    ]);
    expect(result.images).toEqual([]);
    expect(result.rejected[0]?.image).toBe("error.jpg");
  });

  it("prepares several frames independently", async () => {
    const result = await preparer.prepare([
      { bytes: full, label: "card" },
      { bytes: await screenshot(300, 300), label: "caption" },
    ]);
    expect(result.images.map((i) => i.label)).toEqual(["card", "caption"]);
    expect(result.images.map((i) => i.downscaled)).toEqual([true, false]);
  });
});
