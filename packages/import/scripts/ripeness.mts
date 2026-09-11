/**
 * Two numbers that grow on their own, and the thresholds at which they are worth acting on.
 *
 * ---------------------------------------------------------------------------
 * Why a script and not a note
 * ---------------------------------------------------------------------------
 *
 * Both of these improve passively — section coverage with every import that has headings,
 * hand-labelled boundaries with every blend somebody corrects — and neither has anything to do
 * until it has accumulated. The obvious plan is "remember to re-measure", and this project has
 * watched that shape fail enough times to have written it down: *a version stamp only works if
 * somebody turns it.* A number nobody is asked for is a number nobody looks at.
 *
 * So the trigger is a command. `pnpm --filter @pashki/import ripeness` answers "is there enough
 * yet" in one line each, with the threshold beside the count so the answer is checkable rather
 * than asserted.
 *
 * ---------------------------------------------------------------------------
 * What each one unlocks
 * ---------------------------------------------------------------------------
 *
 * **Sections.** Supplying true section headings took component detection from `right` 14 to 25
 * of thirty (§60). The measured corpus had *zero* of them, which is why §60 records today's
 * score as a floor rather than a verdict. Every import carrying headings raises it with no code
 * change — and a stored partition can be recomputed when it does.
 *
 * **Adjusted boundaries.** §61 leaves no confidence signal, so a person correcting a proposed
 * split is the only evaluator. Every correction is a hand label produced as a side effect of
 * somebody cooking — and unlike the thirty I labelled by hand, these are *the household's own
 * recipes* rather than ones I chose, which makes them better evidence than the eval has ever
 * had.
 *
 * Neither threshold is precise and neither pretends to be. Thirty is what the existing labelled
 * set holds, so it is the number at which a comparison is like-for-like.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../../../apps/web/.env.local", import.meta.url), "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !line.startsWith("#")) process.env[line.slice(0, at).trim()] ??= line.slice(at + 1).trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  // could-not-measure is a third outcome and must not read like a zero
  console.error("COULD NOT MEASURE: no Supabase credentials in apps/web/.env.local");
  process.exit(3);
}

/** counts through PostgREST's exact count, so nothing is paged or estimated */
async function count(path: string): Promise<number> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key!,
      authorization: `Bearer ${key!}`,
      prefer: "count=exact",
      range: "0-0",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const range = response.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  if (!Number.isFinite(total)) throw new Error(`no count in content-range: "${range}"`);
  return total;
}

const SECTIONS_WANTED = 30;
const ADJUSTMENTS_WANTED = 30;

try {
  const recipes = await count("recipes?select=id&deleted_at=is.null");
  /*
   * Blends are excluded, and leaving them in was wrong in the direction that flatters.
   *
   * `composeBlend` writes each part's name into `section`, so every blend counts as a recipe
   * "carrying a declared section" — but that is structure this app generated, not a heading a
   * recipe declared, and it tells us nothing about whether imports are getting better. The
   * first run of this script reported four sectioned recipes when four blends existed and the
   * real answer was zero.
   */
  const query =
    "recipe_ingredients?select=recipe_id,recipes!inner(derived_at)" +
    "&section=not.is.null&deleted_at=is.null&recipes.derived_at=is.null";
  const sectionRows = (await (
    await fetch(`${url}/rest/v1/${query}`, {
      headers: { apikey: key!, authorization: `Bearer ${key!}` },
    })
  ).json()) as Array<{ recipe_id: string }>;
  const sectioned = sectionRows.length;
  // distinct recipes: one recipe contributes many rows
  const withSections = new Set(sectionRows.map((row) => row.recipe_id)).size;

  const blends = await count("recipes?select=id&derived_at=not.is.null&deleted_at=is.null");
  const adjusted = await count(
    "recipe_derivations?select=id&adjusted=is.true&deleted_at=is.null",
  );

  const verdict = (have: number, want: number) =>
    have >= want ? `READY — re-measure` : `${want - have} more`;

  console.log(`\n${recipes} recipes, ${blends} of them blends\n`);
  console.log(
    `  imported recipes with their own headings${String(withSections).padStart(4)} / ${SECTIONS_WANTED}   ${verdict(withSections, SECTIONS_WANTED)}`,
  );
  console.log(`     (${sectioned} ingredient rows across them)`);
  console.log(
    `  blend parts a person re-drew          ${String(adjusted).padStart(4)} / ${ADJUSTMENTS_WANTED}   ${verdict(adjusted, ADJUSTMENTS_WANTED)}`,
  );
  console.log(`
  Sections raise component detection with no code change — §60 records today's score as a
  floor because the measured corpus had none. At ${SECTIONS_WANTED}, re-run the components eval
  against recipes that have them and see where the floor actually is.

  Adjusted parts are hand labels made by somebody cooking, on their own recipes rather than
  ones I chose. At ${ADJUSTMENTS_WANTED} they are a held-out set the eval has never had, and the
  question they answer is the one §61 left open: where does detection actually go wrong?
`);
} catch (thrown) {
  console.error(`COULD NOT MEASURE: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  process.exit(3);
}
