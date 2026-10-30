import { createClient } from "@supabase/supabase-js";
import { createHttpFetcher } from "../src/fetcher.js";
import { collectJsonLd, flattenNodes, findRecipeNode } from "../src/jsonld.js";
import { stripTags } from "@pashki/core";

/**
 * How many URL-imported recipes have ingredient groups in their source?
 *
 * The question that decides whether a backfill is worth building at all, asked before proposing
 * one. Read-only: it fetches each `source_url` and reports what the page groups, and writes
 * nothing anywhere.
 *
 * It also tests the assumption the whole design rests on — that a section is a **contiguous run in
 * source order**, so the DOM's group sizes slice the JSON-LD array exactly. Two examples agreed;
 * this asks every source in the library, because an assumption confirmed twice is confirmed twice.
 */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const seed = "61e04d69-e960-4258-90d4-bdc380f1bd36";
const { data: anchor } = await db.from("recipes").select("family_id").eq("id", seed).maybeSingle();
if (!anchor) { console.log("COULD NOT MEASURE: the anchor recipe is gone"); process.exit(2); }

const { data: recipes, error } = await db
  .from("recipes").select("id, title, source_url")
  .eq("family_id", anchor.family_id).is("deleted_at", null)
  .not("source_url", "is", null).order("title").range(0, 999);
if (error || !recipes?.length) { console.log(`COULD NOT MEASURE: ${error?.message ?? "no sourced recipes"}`); process.exit(2); }

const { data: storedLines } = await db
  .from("recipe_ingredients").select("recipe_id, section")
  .in("recipe_id", recipes.map((r) => r.id)).is("deleted_at", null).range(0, 9999);
const storedCount = new Map<string, number>();
for (const l of storedLines ?? []) storedCount.set(l.recipe_id as string, (storedCount.get(l.recipe_id as string) ?? 0) + 1);

/* every plugin writes groups differently; the class name is the only common thread */
const GROUP_BLOCK = /<(div|li)[^>]*class="[^"]*ingredient-group[^"]*"[^>]*>([\s\S]*?)(?=<\1[^>]*class="[^"]*ingredient-group|$)/gi;
const HEADING = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;
const ITEM = /<li[^>]*class="[^"]*ingredient[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;

const fetcher = createHttpFetcher();
const rows: { title: string; status: string; groups: string[]; itemsInGroups: number; jsonld: number; stored: number }[] = [];
for (const r of recipes) {
  const page = await fetcher.page(r.source_url as string).catch((e: Error) => ({ error: e.message }) as never);
  if (!page || "error" in page) {
    rows.push({ title: r.title as string, status: `FETCH ${(page as { error?: string })?.error?.slice(0, 40) ?? "failed"}`, groups: [], itemsInGroups: 0, jsonld: 0, stored: storedCount.get(r.id as string) ?? 0 });
    process.stdout.write("!");
    continue;
  }
  const node = findRecipeNode(flattenNodes(collectJsonLd(page.html)));
  const ings = (node?.recipeIngredient ?? node?.ingredients) as unknown;
  const jsonld = Array.isArray(ings) ? ings.length : 0;

  const groups: string[] = [];
  let itemsInGroups = 0;
  for (const block of page.html.matchAll(GROUP_BLOCK)) {
    const inner = block[2] ?? "";
    const heading = stripTags(HEADING.exec(inner)?.[1] ?? "").replace(/\s+/g, " ").trim();
    const items = [...inner.matchAll(ITEM)].length;
    if (!heading || !items) continue;
    groups.push(heading);
    itemsInGroups += items;
  }
  rows.push({ title: r.title as string, status: "ok", groups, itemsInGroups, jsonld, stored: storedCount.get(r.id as string) ?? 0 });
  process.stdout.write(groups.length ? "G" : ".");
}
console.log("");

const ok = rows.filter((r) => r.status === "ok");
const grouped = ok.filter((r) => r.groups.length > 1);
const aligned = grouped.filter((r) => r.itemsInGroups === r.jsonld && r.jsonld > 0);

console.log(`\n=== ${recipes.length} recipes with a source_url ===`);
console.log(`  fetched: ${ok.length}   could not fetch: ${rows.length - ok.length}`);
console.log(`  with more than one ingredient group: ${grouped.length}`);
console.log(`  of those, group sizes sum to the JSON-LD count: ${aligned.length} of ${grouped.length}`);
console.log(`\n=== the recipes a backfill would fix ===`);
for (const r of grouped) {
  const mark = r.itemsInGroups === r.jsonld ? "ok  " : "SKEW";
  console.log(`  ${mark} ${r.title.slice(0, 42).padEnd(43)} ${r.groups.length} groups, ${r.itemsInGroups} items vs ${r.jsonld} json-ld, ${r.stored} stored`);
  console.log(`         ${r.groups.map((g) => JSON.stringify(g)).join(" / ")}`);
}
const failed = rows.filter((r) => r.status !== "ok");
if (failed.length) {
  console.log(`\n=== could not fetch (${failed.length}) — unknown, not "no sections" ===`);
  for (const r of failed) console.log(`  ${r.title.slice(0, 48).padEnd(49)} ${r.status}`);
}
