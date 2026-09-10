/**
 * Does the agreement number predict a right answer? The gate is only worth having if it does.
 *
 * COMPONENT_TRUST was chosen for coherence — it is the number the eval already uses to decide a
 * component matches its hand label — which is an argument about consistency, not about whether
 * 0.7 separates right from wrong. This is the measurement that can say.
 *
 * Reads the readings captured once by ab-consensus.mts, so it costs no inference and can be
 * re-run freely.
 */
import { readFileSync } from "node:fs";
import { consensusPartition } from "../../core/src/partitions.js";
import { COMPONENT_LABELS, scoreComponents } from "../../core/eval/fixtures/components.js";

type R = { name: string; from: number; to: number; role: string | null };
const readings: Record<string, Array<R[] | null>> = JSON.parse(readFileSync("/tmp/readings.json", "utf8"));

const rows: Array<{ title: string; agreement: number; readings: number; verdict: string }> = [];
for (const label of COMPONENT_LABELS) {
  const rs = readings[label.id];
  if (!rs) continue;
  const agreed = consensusPartition(rs);
  if (!agreed) {
    rows.push({ title: label.title, agreement: 0, readings: 0, verdict: "declined" });
    continue;
  }
  const score = scoreComponents(label.components, agreed.chosen);
  rows.push({
    title: label.title,
    // a lone reading agrees with itself; the write path stores 0 for that and so does this
    agreement: agreed.readings === 1 ? 0 : agreed.agreement,
    readings: agreed.readings,
    verdict: score.verdict,
  });
}

const pct = (n: number, d: number) => (d === 0 ? "  n/a" : `${Math.round((n / d) * 100)}%`.padStart(5));
const show = (name: string, subset: typeof rows) => {
  const right = subset.filter((r) => r.verdict === "right").length;
  console.log(`  ${name.padEnd(34)} n=${String(subset.length).padStart(2)}  right=${String(right).padStart(2)}  ${pct(right, subset.length)}`);
};

console.log(`\nscored ${rows.length} of ${COMPONENT_LABELS.length} labelled recipes\n`);
console.log("BY GATE:");
show("passes gate (>=0.7 AND 3 readings)", rows.filter((r) => r.agreement >= 0.7 && r.readings >= 3));
show("fails gate", rows.filter((r) => !(r.agreement >= 0.7 && r.readings >= 3)));
console.log("\nWHICH HALF OF THE GATE IS DOING THE WORK:");
show("3 readings, any agreement", rows.filter((r) => r.readings >= 3));
show("fewer than 3 readings", rows.filter((r) => r.readings < 3));
show(">=0.7 agreement, any readings", rows.filter((r) => r.agreement >= 0.7));
show("<0.7 agreement", rows.filter((r) => r.agreement < 0.7));

console.log("\nBY AGREEMENT BAND (3 readings only):");
const three = rows.filter((r) => r.readings >= 3);
for (const [lo, hi] of [[0, 0.5], [0.5, 0.7], [0.7, 0.85], [0.85, 1.01]] as const) {
  show(`  ${lo.toFixed(2)}–${hi === 1.01 ? "1.00" : hi.toFixed(2)}`, three.filter((r) => r.agreement >= lo && r.agreement < hi));
}

console.log("\nEVERY ROW:");
for (const r of [...rows].sort((a, b) => b.agreement - a.agreement)) {
  console.log(`  ${r.agreement.toFixed(2)}  ${r.readings}r  ${r.verdict.padEnd(8)} ${r.title.slice(0, 40)}`);
}
