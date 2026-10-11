/**
 * What a Kroger export would actually propose for this household's week (§74, §75).
 *
 * `/api/kroger/propose` needs a session, which a script cannot hold, so this runs the same code
 * paths with the service role: the real `buildShoppingWeek`, the real ticks, the real store. The
 * point is to see **what comes back** before a screen is designed around a guess — the propose
 * route and this script share `findProducts`, so the thing measured is the thing that ships.
 *
 * Reads only. `product.compact` on an app token, which their API refuses to let near a cart.
 */
import { createClient } from "@supabase/supabase-js";
import { buildShoppingWeek } from "../../../apps/web/lib/shopping.js";
import { appToken, findProducts, krogerConfig } from "../../../apps/web/lib/kroger.js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("COULD NOT MEASURE: Supabase url and service role needed.");
  process.exit(2);
}
const config = krogerConfig();
if (!config) {
  console.error("COULD NOT MEASURE: no Kroger credentials for the configured environment.");
  process.exit(2);
}

const weekStart = process.argv[2] ?? "2026-10-05";
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

/*
 * The household is passed in, not looked up. `families` is a platform table and
 * `check-platform-tables` refused the first version of this for reading it — correctly: a
 * measurement script is not a reason to cross that boundary, and the ids are one `curl` away
 * through the seam. So this queries only app tables, which is all a matching measurement needs.
 */
const familyId = process.argv[3];
const storeId = process.argv[4];
const units = process.argv[5] === "metric" ? "metric" : "us";
if (!familyId || !storeId) {
  console.error("COULD NOT MEASURE: usage — kroger:propose <weekStart> <familyId> <storeId> [us|metric]");
  process.exit(2);
}
const family = { id: familyId, kroger_location_id: storeId, measurement_system: units, name: familyId.slice(0, 8) };

const days = Array.from({ length: 7 }, (_, at) => {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + at);
  return date.toISOString().slice(0, 10);
});

const { week, error } = await buildShoppingWeek(
  supabase as never,
  family.id,
  weekStart as never,
  days as never,
  family.measurement_system === "metric" ? "metric" : "us",
);
if (error || !week) {
  console.error(`COULD NOT MEASURE: ${error ?? "no shopping week"}`);
  process.exit(2);
}

console.log(`${family.name}, store ${family.kroger_location_id}, week of ${weekStart}`);
console.log(`${week.lines.length} lines on the list, ${week.ticked.size} ticked\n`);

/* the same exclusions the propose route applies — the ticks are the join consolidate cannot see */
const candidates = week.lines.filter((line) => {
  if (week.ticked.has(line.key)) return false;
  if (line.needed <= 0) return false;
  if (line.inPantry && !line.pantryDeducted) return false;
  return true;
});
const withheld = week.lines.length - candidates.length;
console.log(`${candidates.length} to propose, ${withheld} withheld (ticked, or already in the pantry)\n`);

const token = await appToken(config);
if (!token) {
  console.error("COULD NOT MEASURE: Kroger would not issue an app token.");
  process.exit(2);
}

let matched = 0;
let none = 0;
let aisled = 0;
let priced = 0;
const unmatched: string[] = [];

for (const line of candidates) {
  // `line.key` is the catalog key where the ingredient resolved and normaliseName(text) where it
  // did not — the catalog's word when there is one, the recipe's when there is not
  const term = line.key.replace(/-/g, " ");
  const found = await findProducts(config, token, term, family.kroger_location_id);
  if (!found || found.products.length === 0) {
    none += 1;
    unmatched.push(line.label);
    continue;
  }
  matched += 1;
  const first = found.products[0]!;
  if (first.aisle) aisled += 1;
  if (first.priceCents !== null) priced += 1;
  const price = first.priceCents === null ? "no price" : `$${(first.priceCents / 100).toFixed(2)}`;
  console.log(
    `  ${line.label.slice(0, 24).padEnd(26)} ${String(line.neededDisplay).padEnd(12)} ` +
      `→ ${found.products.length} option(s), first: ${first.description.slice(0, 40).padEnd(42)} ` +
      `${price.padEnd(9)} ${first.aisle ?? "-"}`,
  );
}

const total = candidates.length;
const pc = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : "-");
console.log(`\n  matched            ${String(matched).padStart(3)} / ${total}   ${pc(matched)}`);
console.log(`  nothing matched    ${String(none).padStart(3)} / ${total}   ${pc(none)}`);
console.log(`  carried an aisle   ${String(aisled).padStart(3)} / ${matched}  (of those matched)`);
console.log(`  carried a price    ${String(priced).padStart(3)} / ${matched}`);
if (unmatched.length > 0) console.log(`\n  unmatched: ${unmatched.join(", ")}`);
