/**
 * The household's recipes, as the measurement scripts expect them.
 *
 * `measure-components.mts` read `/tmp/clean.json` and nothing in the repository produced it, so
 * the number that every component decision rests on could not be reproduced from a clean
 * checkout — it depended on a temp file from whenever it was last made by hand. A measurement
 * that cannot be re-run is one that quietly stops being run, and then a stale figure gets quoted
 * because re-deriving it is work.
 *
 * Service role, because this reads every household's recipes for scoring rather than serving a
 * screen. It writes to /tmp on purpose: it is a derived cache of production data, and the one
 * place it must not be is the repository.
 */
import { writeFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("COULD NOT MEASURE: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY needed.");
  process.exit(2);
}

const response = await fetch(
  `${url}/rest/v1/recipes?select=id,title,recipe_ingredients(position,amount,unit,item_text,section,deleted_at)&deleted_at=is.null&limit=1000`,
  { headers: { apikey: key, authorization: `Bearer ${key}` } },
);
if (!response.ok) {
  console.error(`COULD NOT MEASURE: recipes came back ${response.status}`);
  process.exit(2);
}

type Row = {
  id: string;
  title: string;
  recipe_ingredients: Array<{
    position: number | null;
    amount: number | null;
    unit: string | null;
    item_text: string | null;
    section: string | null;
    deleted_at: string | null;
  }> | null;
};

const rows = (await response.json()) as Row[];
const corpus = rows.map((row) => ({
  id: row.id,
  title: row.title,
  // deleted lines are not sent to the model, so they must not be scored against either
  recipe_ingredients: (row.recipe_ingredients ?? [])
    .filter((line) => line.deleted_at === null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((line) => ({
      position: line.position ?? 0,
      amount: line.amount,
      unit: line.unit,
      item_text: line.item_text ?? "",
      section: line.section,
    })),
}));

writeFileSync("/tmp/clean.json", JSON.stringify(corpus));
const withSections = corpus.filter((r) => r.recipe_ingredients.some((l) => l.section)).length;
console.log(`/tmp/clean.json — ${corpus.length} recipes, ${withSections} with declared sections`);
