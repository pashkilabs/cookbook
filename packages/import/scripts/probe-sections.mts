import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../../apps/web/.env.local", import.meta.url), "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !line.startsWith("#")) process.env[line.slice(0, at).trim()] ??= line.slice(at + 1).trim();
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const q = async (p: string) => {
  const r = await fetch(`${url}/rest/v1/${p}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};
const since = await q("recipes?select=id,title,created_at&created_at=gte.2026-09-09&deleted_at=is.null&order=created_at.desc");
console.log(`recipes created since the section column landed (2026-09-09): ${since.length}`);
for (const r of since.slice(0, 10)) console.log(`   ${r.created_at.slice(0, 16)}  ${r.title.slice(0, 46)}`);
const anySection = await q("recipe_ingredients?select=id,recipe_id,item_text,section&section=not.is.null&limit=5");
console.log(`\ningredient rows with a section, ever: ${anySection.length}`);
for (const i of anySection) console.log(`   ${i.section} :: ${i.item_text}`);
