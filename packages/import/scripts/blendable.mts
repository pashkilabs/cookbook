/**
 * How many recipes actually yield two parts? Everything in step 4 rests on it.
 *
 * From the readings already captured, so it costs no inference — the question is about the
 * partitions, and those are on disk.
 */
import { readFileSync } from "node:fs";
import { consensusPartition } from "../../core/src/partitions.js";
import { COMPONENT_LABELS } from "../../core/eval/fixtures/components.js";

type R = { name: string; from: number; to: number; role: string | null };
const readings: Record<string, Array<R[] | null>> = JSON.parse(readFileSync("/tmp/readings.json", "utf8"));

let twoPlus = 0, one = 0, none = 0;
const truthTwoPlus = COMPONENT_LABELS.filter((l) => l.components.length >= 2).length;

for (const label of COMPONENT_LABELS) {
  const rs = readings[label.id];
  if (!rs) continue;
  const agreed = consensusPartition(rs);
  if (!agreed) { none += 1; continue; }
  if (agreed.chosen.length >= 2) twoPlus += 1; else one += 1;
}
const n = twoPlus + one + none;
console.log(`\n${n} recipes with readings on disk\n`);
console.log(`  yield 2+ parts (blendable by part)   ${twoPlus}   ${Math.round(twoPlus / n * 100)}%`);
console.log(`  yield 1 part  (whole-recipe only)    ${one}   ${Math.round(one / n * 100)}%`);
console.log(`  no partition at all                  ${none}   ${Math.round(none / n * 100)}%`);
console.log(`\n  ...and by the HAND LABELS, ${truthTwoPlus} of ${COMPONENT_LABELS.length} genuinely have 2+ parts (${Math.round(truthTwoPlus / COMPONENT_LABELS.length * 100)}%)`);
console.log(`     so the ceiling is ${truthTwoPlus}, and detection is finding ${twoPlus} of them.`);
