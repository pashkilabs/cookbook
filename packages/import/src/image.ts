import type { ImportedPhoto } from "./types.js";

/**
 * Validate an image by decoding it, never by the content type claimed.
 *
 * A proxy will happily return `Content-Type: image/jpeg` for an HTML error page, and
 * a CDN will return `application/octet-stream` for a perfectly good JPEG. The
 * headers are worthless either way, so the bytes decide.
 *
 * "Decoding" here means parsing the container far enough to recover the real format
 * and dimensions from the bytes. That rejects everything the header check would have
 * let through — HTML, empty responses, truncated files — without a native image
 * dependency. It is not a full pixel decode: a file with a valid header and corrupt
 * scan data would pass here and fail in a browser.
 */
export type ImageFormat = ImportedPhoto["format"];

export interface DecodedImage {
  format: ImageFormat;
  width: number;
  height: number;
}

export function decodeImage(bytes: Uint8Array): DecodedImage | null {
  return decodePng(bytes) ?? decodeJpeg(bytes) ?? decodeGif(bytes) ?? decodeWebp(bytes);
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function decodePng(bytes: Uint8Array): DecodedImage | null {
  if (bytes.length < 24) return null;
  for (const [index, expected] of PNG_MAGIC.entries()) {
    if (bytes[index] !== expected) return null;
  }
  // the IHDR chunk must come first, and carries the dimensions
  if (readAscii(bytes, 12, 4) !== "IHDR") return null;
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  return usable(width, height) ? { format: "png", width, height } : null;
}

function decodeGif(bytes: Uint8Array): DecodedImage | null {
  if (bytes.length < 10) return null;
  const header = readAscii(bytes, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  return usable(width, height) ? { format: "gif", width, height } : null;
}

function decodeWebp(bytes: Uint8Array): DecodedImage | null {
  if (bytes.length < 30) return null;
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WEBP") return null;

  const chunk = readAscii(bytes, 12, 4);
  if (chunk === "VP8X") {
    // 24-bit canvas size, minus one
    const width = 1 + (readUint24LE(bytes, 24) & 0xffffff);
    const height = 1 + readUint24LE(bytes, 27);
    return usable(width, height) ? { format: "webp", width, height } : null;
  }
  if (chunk === "VP8 ") {
    const width = readUint16LE(bytes, 26) & 0x3fff;
    const height = readUint16LE(bytes, 28) & 0x3fff;
    return usable(width, height) ? { format: "webp", width, height } : null;
  }
  if (chunk === "VP8L") {
    const bits =
      (bytes[21]! << 24) | (bytes[22]! << 16) | (bytes[23]! << 8) | bytes[24]!;
    // 14 bits each, little-endian bitstream, minus one
    const width = 1 + ((bits >>> 18) & 0x3fff);
    const height = 1 + ((bits >>> 4) & 0x3fff);
    return usable(width, height) ? { format: "webp", width, height } : null;
  }
  return null;
}

/**
 * Walk the JPEG segment chain to a start-of-frame marker.
 *
 * A JPEG's dimensions are not at a fixed offset — they sit in whichever SOF segment
 * appears after however many APPn and comment segments the encoder wrote. Skipping
 * segment by segment is the only way to find it, and reaching the end without one
 * means this is not a usable JPEG whatever the header said.
 */
function decodeJpeg(bytes: Uint8Array): DecodedImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;

    // padding, and markers that carry no payload
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    // start of scan: the dimensions were before this or not at all
    if (marker === 0xda) return null;

    const length = readUint16BE(bytes, offset + 2);
    if (length < 2) return null;

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      const height = readUint16BE(bytes, offset + 5);
      const width = readUint16BE(bytes, offset + 7);
      return usable(width, height) ? { format: "jpeg", width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * A one-pixel image is a tracking pixel, and a spacer GIF is not a recipe photo.
 * Anything this small is noise the page happened to mark up.
 */
const MIN_DIMENSION = 32;

function usable(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= MIN_DIMENSION &&
    height >= MIN_DIMENSION
  );
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
  );
}
