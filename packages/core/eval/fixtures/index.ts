import type { FixtureSet } from "../types.js";
import { placeholderCaptionPaste } from "./placeholder-caption-paste.js";
import { placeholderScreenshotReel } from "./placeholder-screenshot-reel.js";
import { placeholderUrlSnapshot } from "./placeholder-url-snapshot.js";

/**
 * The fixture set. Adding one is: write the file, import it, list it here.
 *
 * Everything below is a placeholder demonstrating a shape — three inputs, no
 * measurement. Real fixtures come from real sources with hand-checked output;
 * invented ones would only prove the parser handles recipes nobody cooks.
 */
export const FIXTURES: FixtureSet = [
  placeholderUrlSnapshot,
  placeholderCaptionPaste,
  placeholderScreenshotReel,
];
