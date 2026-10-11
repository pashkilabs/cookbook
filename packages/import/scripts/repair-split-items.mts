/**
 * Repair rows where a comma joining adjectives was read as "item, preparation".
 *
 * The parser is fixed, but a fix only affects *new* parses — the stored rows still say
 * `boneless`, with the chicken in the note, in six recipes. Every consumer reads `item_text`, so
 * those recipes are invisible to a poultry search, buy "boneless" on the shopping list, and read
 * clear for every allergen in them.
 *
 * **Re-parsed rather than patched.** The original line is reconstructed as `item, note` and put
 * back through `parseIngredientLine`, so the repair uses the same code the fix lives in. Ad-hoc
 * string surgery would be a second implementation of the rule, and the two would agree only
 * until somebody edited one of them.
 *
 * Dry run by default. Pass `--write` to apply.
 */
import { parseIngredientLine, isStaple } from "../../core/src/index.js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("COULD NOT MEASURE: Supabase url and service role needed.");
  process.exit(2);
}
const write = process.argv.includes("--write");

const PREP_ONLY = new Set([
  "boneless", "skinless", "bone", "in", "cooked", "chopped", "diced", "minced", "sliced",
  "shredded", "grated", "crushed", "cubed", "halved", "quartered", "peeled", "seeded",
  "trimmed", "drained", "rinsed", "melted", "softened", "fresh", "frozen", "dried", "raw",
  "thinly", "finely", "roughly", "coarsely", "large", "small", "medium", "skin", "on",
]);
/** the same question the parser now asks: has the noun arrived yet */
const namesSomething = (head: string) =>
  head
    .toLowerCase()
    .replace(/[^a-z\s&-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length > 1 || word === "&")
    .some((word) => !PREP_ONLY.has(word));

const rest = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key, authorization: `Bearer ${key}`,
      "content-type": "application/json", prefer: "return=representation",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    console.error(`COULD NOT MEASURE: ${path} came back ${response.status} ${await response.text()}`);
    process.exit(2);
  }
  return response.json() as Promise<any[]>;
};

const rows = await rest(
  "recipe_ingredients?select=id,item_text,amount,unit,note,recipe_id,recipes(title)&deleted_at=is.null&limit=2000",
);

/*
 * Two detections now, because the second class is wider than the first.
 *
 *   names no food   the `boneless` class: an item made entirely of modifier words.
 *   re-parses       any row whose reconstructed line parses to a *different* item under the
 *   differently     current parser — which catches the §74 class (`15oz can whole kernel corn`,
 *                   `+ 2 tablespoons red wine vinegar`) without anybody enumerating it.
 *
 * The second is the general form and would have caught the first. It is also the honest one: it
 * asks "does today's parser disagree with what is stored", which is the actual question whenever
 * a parser is fixed and rows predate the fix.
 */
const broken = rows.filter((row) => {
  const text = (row.item_text ?? "").trim();
  if (!text || isStaple(text)) return false;
  if (!namesSomething(text)) return true;
  /*
   * **Debris, not disagreement.** The detection was "today's parser reads this differently", which
   * is right on a first pass and wrong on a second: re-parsing an already-correct name applies the
   * modifier rules again, so `whole kernel corn` became `kernel corn` and `whole bone-in pork
   * butt` lost its `whole`. Running it until it reported zero looked like convergence and was
   * **erosion** — a repair that changes its own output will keep changing it.
   *
   * So a row qualifies only when the stored item carries something that is **not part of a food
   * name**: a digit, leading punctuation, a continuation marker, or a measure word standing where
   * a food should be. That bounds the repair to the damage and makes it idempotent — a clean name
   * is never a candidate, however the parser would re-read it.
   */
  const debris =
    /\d/.test(text) ||
    /^[^A-Za-z(]/.test(text) ||
    /^\(/.test(text) ||
    /\(\s*$|^\s*\)/.test(text) ||
    /^(?:plus|and|or)\b/i.test(text) ||
    /\b(?:oz|lb|lbs|kg|ml|inch)\b/i.test(text);
  if (!debris) return false;

  const unwrapped = (row.note ?? "").trim().replace(/^\((.*)\)$/s, "$1");
  const original = [row.item_text, unwrapped].filter(Boolean).join(", ");
  const reparsed = parseIngredientLine([row.amount ?? "", row.unit ?? "", original].join(" ").trim());
  return Boolean(reparsed?.item) && reparsed!.item !== text;
});
console.log(`${rows.length} rows; ${broken.length} that today's parser reads differently\n`);

let changed = 0;
for (const row of broken) {
  /*
   * The note is unwrapped before rejoining.
   *
   * Two rows carry `note: "(skinless chicken breasts)"`, so the reconstructed line reads
   * `boneless, (skinless chicken breasts)` — and the trailing-paren rule strips that straight
   * back into a note, leaving `boneless` untouched. Those two reported SKIP rather than quietly
   * failing, which is how they were found. Unwrapping one pair of parens is lossy in the case
   * where the source really had them, and the loss is a note rather than an ingredient.
   */
  const unwrapped = (row.note ?? "").trim().replace(/^\((.*)\)$/s, "$1");
  const original = [row.item_text, unwrapped].filter(Boolean).join(", ");
  const parsed = parseIngredientLine([row.amount ?? "", row.unit ?? "", original].join(" ").trim());
  if (!parsed?.item || parsed.item === row.item_text) {
    console.log(`  SKIP  ${row.item_text} — re-parsing produced ${JSON.stringify(parsed?.item ?? null)}`);
    continue;
  }
  console.log(`  ${(row.recipes?.title ?? "?").slice(0, 28).padEnd(30)} ${JSON.stringify(row.item_text)} → ${JSON.stringify(parsed.item)}`);
  /*
   * The note is tidied, because reconstruction is lossy at the seams.
   *
   * `"ginger ("` came back as `ginger` with the note `", freshly grated (Note 3"` — the item is
   * right and the note has acquired a leading comma and an orphaned bracket from being taken
   * apart and put back together. A note is read by people, so it is cleaned rather than left as
   * evidence of the process that produced it.
   */
  const note = (parsed.note ?? "")
    .replace(/^[\s,;]+/, "")
    .replace(/[\s,;]+$/, "")
    .replace(/\(([^()]*)$/, "$1")
    .replace(/^([^()]*)\)/, "$1")
    .trim();
  console.log(`      note ${JSON.stringify(row.note)} → ${JSON.stringify(note || null)}`);
  if (write) {
    await rest(`recipe_ingredients?id=eq.${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ item_text: parsed.item, note }),
    });
  }
  changed += 1;
}

console.log("");
console.log(write ? `REPAIRED ${changed} rows.` : `DRY RUN — ${changed} rows would change. Pass --write to apply.`);
