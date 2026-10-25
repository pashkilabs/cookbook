export * from "./types.js";
export * from "./score.js";
export * from "./runner.js";
export * from "./report.js";
export * from "./validate.js";
export { coreParser } from "./extractors/core-parser.js";
export { FIXTURES } from "./fixtures/index.js";
/*
 * The caption adjudication and its scorers, exported because nothing could reach them.
 *
 * `CAPTION_CLASS_EXPECTATIONS` and `CAPTION_AXIS_EXPECTATIONS` cover all four classification axes
 * for the eighteen caption files under `intake/captions`, and the only consumer was a unit test of
 * the scoring functions — so the figure quoted from them had no runner. `measure-captions.mts` is
 * the runner, and it imports through here.
 */
export * from "./fixtures/caption-steps.js";
