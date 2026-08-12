import sharp from "sharp";
import { DEFAULT_IMAGE_LIMITS, type ImagePreparer, type PrepareResult } from "./prepare-image.js";

/**
 * The real image preparer: downscales to the limits and re-encodes as JPEG.
 *
 * A separate entry point (`@pashki/import/sharp`) so the main one does not load a
 * native module. Anything that only wants tiers 0 and 1 should not pay for libvips at
 * import time, and a cold start on a serverless function is exactly where that shows.
 *
 * JPEG on the way out regardless of what came in. A phone screenshot is a PNG of
 * mostly photographic content, which is the worst case for PNG — the same picture as
 * JPEG is routinely five to ten times smaller with no difference a model could read.
 *
 * `withoutEnlargement` matters: an already-small crop of a caption must not be
 * upscaled into a blurry larger one that costs more and reads worse.
 */
export function createSharpImagePreparer(): ImagePreparer {
  return {
    async prepare(images, limits = DEFAULT_IMAGE_LIMITS): Promise<PrepareResult> {
      const prepared: PrepareResult["images"] = [];
      const rejected: PrepareResult["rejected"] = [];

      for (const [index, image] of images.entries()) {
        const name = image.label ?? `image ${index}`;
        try {
          const input = sharp(Buffer.from(image.bytes), { failOn: "error" });
          const original = await input.metadata();

          const pipeline = input
            // apply the EXIF orientation and then drop the metadata — sharp writes
            // none by default, and a screenshot's EXIF can carry a device identifier
            // that has no business in a prompt
            .rotate()
            .resize({
              width: limits.maxDimension,
              height: limits.maxDimension,
              fit: "inside",
              withoutEnlargement: true,
            });

          let quality = 80;
          let output = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer({
            resolveWithObject: true,
          });

          // one step down if it is still over the byte ceiling. Not a loop to
          // convergence: past this the picture is worse than the saving is worth, and
          // a tier that spends unbounded CPU to save cents is the wrong trade.
          if (output.data.byteLength > limits.maxBytes) {
            quality = 60;
            output = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer({
              resolveWithObject: true,
            });
          }

          if (output.data.byteLength > limits.maxBytes) {
            rejected.push({
              image: name,
              detail: `still ${output.data.byteLength} bytes at quality ${quality}`,
            });
            continue;
          }

          prepared.push({
            mediaType: "image/jpeg",
            bytes: new Uint8Array(output.data),
            width: output.info.width,
            height: output.info.height,
            // whether it was actually resampled, not merely offered up for it
            downscaled:
              output.info.width < (original.width ?? output.info.width) ||
              output.info.height < (original.height ?? output.info.height),
            ...(image.label === undefined ? {} : { label: image.label }),
          });
        } catch (thrown) {
          rejected.push({
            image: name,
            detail: thrown instanceof Error ? thrown.message : String(thrown),
          });
        }
      }

      return { images: prepared, rejected };
    },
  };
}
