import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { cascadeFromEnv } from "../src/openai-compatible.js";
import { inferComponents } from "../src/components.js";
import { consensusPartition } from "../../core/src/partitions.js";
import { COMPONENT_LABELS, scoreComponents } from "../../core/eval/fixtures/components.js";

const CACHE = "/tmp/readings.json";
type R = { from: number; to: number; role: string | null };

// capture the three readings ONCE, then score both implementations on identical input — the
// previous comparison confounded a code change with model variance and was not a result
if (!existsSync(CACHE)) {
  const cascade = cascadeFromEnv()!;
  const recipes: Array<{ id: string; recipe_ingredients: Array<{ position: number; amount: number | null; unit: string | null; item_text: string }> }> =
    JSON.parse(readFileSync("/tmp/clean.json", "utf8"));
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const out: Record<string, Array<R[] | null>> = {};
  let lost = 0;
  for (const label of COMPONENT_LABELS) {
    const recipe = byId.get(label.id);
    if (!recipe) continue;
    const lines = recipe.recipe_ingredients.sort((a, b) => a.position - b.position)
      .map((i) => [i.amount ?? "", i.unit ?? "", i.item_text].join(" ").trim());
    const readings: Array<R[] | null> = [];
    for (let run = 0; run < 3; run += 1) {
      try {
        readings.push(await inferComponents({ provider: cascade.provider, model: cascade.models[0]!,
          recipe: { title: label.title, ingredients: lines } }));
      } catch (thrown) {
        /*
         * regression: this pushed null for a throw as well as for a decline, so a provider
         * outage was indistinguishable from a model refusing to answer. Together returned 503
         * for two calls in three across a multi-hour window and the run looked like a model
         * that had stopped finding components. A transport failure is `could not measure`,
         * which is a third outcome and not a result.
         */
        lost += 1;
        readings.push(null);
        if (lost <= 3) console.log(`  lost a run: ${(thrown as Error).message.slice(0, 60)}`);
      }
    }
    out[label.id] = readings;
    console.log(`captured ${label.title.slice(0, 40)}  [${readings.map((r) => (r ? r.length : "-")).join(",")}]`);
  }
  /*
   * Refuse to cache a capture the provider ruined. Silence reads as success, and a cache file
   * full of nulls scores as "both implementations declined equally" — a tidy, meaningless tie.
   */
  const attempted = Object.keys(out).length * 3;
  if (lost > attempted / 4) {
    console.error(`\nCOULD NOT MEASURE: ${lost} of ${attempted} calls were lost in transport.`);
    console.error("Not written. The provider, not the consensus code, is what this would measure.");
    process.exit(3);
  }
  writeFileSync(CACHE, JSON.stringify(out));
}

const readings: Record<string, Array<R[] | null>> = JSON.parse(readFileSync(CACHE, "utf8"));

/** the shipped-then-reviewed version: greedy assignment, medoid over all readings */
function oldConsensus(rs: Array<R[] | null>): R[] | null {
  const live = rs.filter((r): r is R[] => Array.isArray(r) && r.length > 0);
  if (live.length === 0) return null;
  if (live.length === 1) return live[0]!;
  const spread = (c: R) => { const s = new Set<number>(); for (let i = c.from; i <= c.to; i += 1) s.add(i); return s; };
  const ov = (a: Set<number>, b: Set<number>) => { let n = 0; for (const x of a) if (b.has(x)) n += 1; return n / Math.max(a.size, b.size); };
  const oneWay = (from: R[], to: R[]) => {
    const taken = new Set<number>(); let total = 0;
    for (const c of from) { const want = spread(c); let best = -1, bs = 0;
      to.forEach((d, i) => { if (taken.has(i)) return; const s = ov(want, spread(d)); if (s > bs) { bs = s; best = i; } });
      if (best >= 0) taken.add(best); total += bs; }
    return total / from.length;
  };
  const agree = (a: R[], b: R[]) => (oneWay(a, b) + oneWay(b, a)) / 2;
  let best = 0, bs = -1;
  live.forEach((c, i) => {
    let t = 0; live.forEach((o, j) => { if (i !== j) t += agree(c, o); });
    const m = t / (live.length - 1); if (m > bs) { bs = m; best = i; }
  });
  return live[best]!;
}

const before = { right: 0, wrong: 0, declined: 0 };
const after = { right: 0, wrong: 0, declined: 0 };
let beforeFound = 0, afterFound = 0, expected = 0;
const flips: string[] = [];

for (const label of COMPONENT_LABELS) {
  const rs = readings[label.id];
  if (!rs) continue;
  const o = scoreComponents(label.components, oldConsensus(rs));
  const n = scoreComponents(label.components, consensusPartition(rs)?.chosen ?? null);
  before[o.verdict] += 1; after[n.verdict] += 1;
  beforeFound += o.matched; afterFound += n.matched; expected += o.countExpected;
  if (o.verdict !== n.verdict) flips.push(`  ${label.title.slice(0, 40).padEnd(41)} ${o.verdict} -> ${n.verdict}   (want ${o.countExpected}, old got ${o.countProposed}, new got ${n.countProposed})`);
}

console.log(`\nIDENTICAL READINGS, two implementations:`);
console.log(`  OLD (greedy, medoid over all)   right ${before.right}  wrong ${before.wrong}  declined ${before.declined}  found ${beforeFound}/${expected}`);
console.log(`  NEW (exact, count voted first)  right ${after.right}  wrong ${after.wrong}  declined ${after.declined}  found ${afterFound}/${expected}`);
console.log(`\nverdict changes: ${flips.length}`);
flips.forEach((f) => console.log(f));
