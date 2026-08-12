import { decodeImage } from "./image.js";
import type { ImageInput } from "./provider.js";

/**
 * Preparing screenshots before they go to a model.
 *
 * A full-size phone screenshot is several megabytes and a few thousand pixels tall.
 * Sending that is slower and costs more for no accuracy gain — vision models tile
 * images to a fixed resolution internally, so pixels above their ceiling are paid
 * for and then thrown away.
 *
 * Behind a port because real resampling needs an image library, and the tests should
 * not. `createSharpImagePreparer` in `./sharp-preparer.ts` is the real one.
 */

export interface SourceImage {
  bytes: Uint8Array;
  /** for error messages and for the eval harness to name a fixture */
  label?: string;
}

export interface PreparedImage extends ImageInput {
  width: number;
  height: number;
  /** true when this image was resampled rather than passed through */
  downscaled: boolean;
  label?: string;
}

export interface ImageLimits {
  /** longest edge, in pixels */
  maxDimension: number;
  /** hard ceiling on what is sent, per image */
  maxBytes: number;
}

/**
 * Placeholder limits, like the model choice.
 *
 * 1568 is a common vision-model tile ceiling, so it is a defensible starting point
 * rather than a measured one — the right numbers are whatever the fixtures show costs
 * least for equal accuracy.
 */
export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxDimension: 1568,
  maxBytes: 1_500_000,
};

export type PrepareFailure = { image: string; detail: string };

export interface PrepareResult {
  images: PreparedImage[];
  /** images that could not be used, with why — never silently dropped */
  rejected: PrepareFailure[];
}

export interface ImagePreparer {
  prepare(images: readonly SourceImage[], limits?: ImageLimits): Promise<PrepareResult>;
}

const MEDIA_TYPE: Record<string, ImageInput["mediaType"] | undefined> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  // a model cannot read an animated GIF frame usefully, and a screenshot is never one
  gif: undefined,
};

/**
 * Validates and passes through. Does not resample.
 *
 * Used by tests, and honest for a caller that has already resized. An image over the
 * limits is **rejected with a reason** rather than sent anyway — quietly sending a
 * 12 MB screenshot is how a cheap tier becomes an expensive one.
 */
export function createPassthroughImagePreparer(): ImagePreparer {
  return {
    async prepare(images, limits = DEFAULT_IMAGE_LIMITS): Promise<PrepareResult> {
      const prepared: PreparedImage[] = [];
      const rejected: PrepareFailure[] = [];

      for (const [index, image] of images.entries()) {
        const name = image.label ?? `image ${index}`;
        // decode rather than trust: the same rule as the photo pipeline
        const decoded = decodeImage(image.bytes);
        if (!decoded) {
          rejected.push({ image: name, detail: "not a decodable image" });
          continue;
        }
        const mediaType = MEDIA_TYPE[decoded.format];
        if (!mediaType) {
          rejected.push({ image: name, detail: `${decoded.format} is not supported for vision` });
          continue;
        }
        const longestEdge = Math.max(decoded.width, decoded.height);
        if (longestEdge > limits.maxDimension) {
          rejected.push({
            image: name,
            detail: `${decoded.width}x${decoded.height} exceeds ${limits.maxDimension}px and this preparer cannot resample`,
          });
          continue;
        }
        if (image.bytes.byteLength > limits.maxBytes) {
          rejected.push({
            image: name,
            detail: `${image.bytes.byteLength} bytes exceeds ${limits.maxBytes}`,
          });
          continue;
        }
        prepared.push({
          mediaType,
          bytes: image.bytes,
          width: decoded.width,
          height: decoded.height,
          downscaled: false,
          ...(image.label === undefined ? {} : { label: image.label }),
        });
      }

      return { images: prepared, rejected };
    },
  };
}
