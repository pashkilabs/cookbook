/**
 * `pnpm --filter @pashki/core eval`
 *
 * Runs the fixture set through one extractor and prints the report. Swapping
 * the extractor below is the whole point of the interface: when an inference
 * layer exists, it plugs in here and the numbers become comparable.
 *
 * Exits non-zero only when a fixture is malformed. Failing checks are not an
 * error — measuring them is the job.
 */
import { coreParser } from "./extractors/core-parser.js";
import { FIXTURES } from "./fixtures/index.js";
import { formatReport } from "./report.js";
import { runEval } from "./runner.js";
import { validateFixtures } from "./validate.js";

const problems = validateFixtures(FIXTURES);
if (problems.length > 0) {
  console.log(`${problems.length} malformed ${problems.length === 1 ? "fixture" : "fixtures"}:`);
  for (const problem of problems) console.log(`  ${problem}`);
  process.exitCode = 1;
} else {
  const report = await runEval(FIXTURES, coreParser, { label: "core/parseIngredientList" });
  console.log(formatReport(report));
}
