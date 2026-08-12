import { describe, expect, it } from "vitest";
import { decodeImage } from "../src/index.js";
import { HTML_PRETENDING_TO_BE_AN_IMAGE, gifBytes, jpegBytes, pngBytes } from "./fixtures.js";

describe("validating by decoding, not by content type", () => {
  it("recovers the real dimensions from a JPEG", () => {
    // and it has to walk past an APP0 and a comment segment to find them — the
    // dimensions are not at a fixed offset
    expect(decodeImage(jpegBytes(640, 480))).toEqual({
      format: "jpeg",
      width: 640,
      height: 480,
    });
  });

  it("recovers them from a PNG", () => {
    expect(decodeImage(pngBytes(1200, 800))).toEqual({
      format: "png",
      width: 1200,
      height: 800,
    });
  });

  it("recovers them from a GIF", () => {
    expect(decodeImage(gifBytes(64, 64))).toEqual({ format: "gif", width: 64, height: 64 });
  });

  it("rejects HTML that a proxy labelled image/jpeg", () => {
    // regression: trusting the declared content type stored error pages as photos
    expect(decodeImage(HTML_PRETENDING_TO_BE_AN_IMAGE)).toBeNull();
  });

  it("rejects an empty or truncated response", () => {
    expect(decodeImage(new Uint8Array(0))).toBeNull();
    expect(decodeImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(decodeImage(pngBytes().slice(0, 12))).toBeNull();
  });

  it("rejects a JPEG whose header is right but has no frame", () => {
    // SOI then straight to a scan: nothing ever declared a size
    expect(decodeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("rejects a tracking pixel", () => {
    // a 1×1 GIF is marked up like an image and is not a recipe photo
    expect(decodeImage(gifBytes(1, 1))).toBeNull();
    expect(decodeImage(pngBytes(1, 1))).toBeNull();
  });

  it("rejects bytes that are not an image at all", () => {
    expect(decodeImage(new TextEncoder().encode("PK zip file"))).toBeNull();
    expect(decodeImage(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
  });
});
