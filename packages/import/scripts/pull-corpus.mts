/**
 * The production corpus, with the fields a compatibility rule needs.
 *
 * Separate from /tmp/clean.json because that dump predates `time_minutes`, and the whole of the
 * mechanism tier is a claim about time at temperature.
 */
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(new URL("../../../apps/web/.env.local", import.meta.url), "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !line.startsWith("#")) process.env[line.slice(0, at).trim()] ??= line.slice(at + 1).trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const select =
  "id,title,time_minutes,principal_protein,course,dish_form," +
  "recipe_ingredients(position,item_text,amount,unit,section),recipe_steps(position,text)";
// regression: filtering only the parent left tombstoned ingredients in the embed, doubling every line
const query =
  `recipes?select=${select}&deleted_at=is.null&recipe_ingredients.deleted_at=is.null&recipe_steps.deleted_at=is.null&limit=500`;

const response = await fetch(`${url}/rest/v1/${query}`, {
  headers: { apikey: key, authorization: `Bearer ${key}` },
});
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
const rows = await response.json();
writeFileSync("/tmp/corpus.json", JSON.stringify(rows));
console.log(`pulled ${rows.length} recipes, ${rows.filter((r: any) => r.time_minutes !== null).length} with a time`);
