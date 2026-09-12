import fs from "node:fs";
import { consolidate } from "/Users/stephenlundall/Documents/Projects/cookbook/packages/core/src/consolidate.js";
import { createCatalog } from "/Users/stephenlundall/Documents/Projects/cookbook/packages/core/src/catalog.js";
import { catalogItemsFromRows } from "/Users/stephenlundall/Documents/Projects/cookbook/packages/db/src/catalog.js";
const D="/private/tmp/claude-502/-Users-stephenlundall-Documents-Projects-cookbook/f9be34de-6d77-441e-a7ad-4258c8ba3e30/scratchpad/";
const L=(n:string)=>JSON.parse(fs.readFileSync(D+n+".json","utf8"));
const FAM="b2ef8bf0-2cae-48ff-8b58-19d6b36a955d";
const pe=L("plan_entries").filter((e:any)=>e.family_id===FAM&&!e.deleted_at&&e.date>="2026-09-07"&&e.date<="2026-09-13");
const ri=L("recipe_ingredients"), rec=L("recipes"), ing=L("ingredients");
const pk=JSON.parse(fs.readFileSync(D+"packages.json","utf8"));
const items=ing.map((i:any)=>({key:i.key,names:[i.canonical_name,...(i.aliases||[])],aisle:i.aisle,dimension:i.dimension,gramsPerCup:i.grams_per_cup??undefined,gramsEach:i.grams_each??undefined,canSize:i.can_size??undefined,
 packages:pk.filter((p:any)=>p.ingredient_id===i.id).map((p:any)=>({label:p.label,amount:Number(p.base_amount),unit:p.unit,system:p.system}))}));
const catalog=createCatalog(catalogItemsFromRows(ing as any, pk as any, "us") as any);
const entries=pe.map((e:any)=>({label:(rec.find((r:any)=>r.id===e.recipe_id)||{}).title,groupKey:e.date,scale:Number(e.scale),
 ingredients:ri.filter((i:any)=>i.recipe_id===e.recipe_id&&!i.deleted_at).map((i:any)=>({item:i.item_text,amount:i.amount??undefined,unit:i.unit??undefined}))}));
const pantry=L("pantry_items").filter((x:any)=>x.family_id===FAM&&!x.deleted_at).map((x:any)=>({name:x.name,...(x.amount===null?{}:{amount:Number(x.amount)}),...(x.unit===null?{}:{unit:x.unit})}));
const lines=consolidate(entries as any,catalog,{pantry,deductPantry:true,system:"us"});
console.log("pantry entries:",pantry.length,"lines flagged inPantry:",0);
console.log("lines:",lines.length);
const withPkg=lines.filter((l:any)=>l.packages&&l.packages.length);
console.log("lines with package advice:",withPkg.length);
console.log("lines with an aisle other than Other:",lines.filter((l:any)=>l.aisle&&l.aisle!=="Other").length);
const aisles:any={};lines.forEach((l:any)=>aisles[l.aisle]=(aisles[l.aisle]||0)+1);
console.log("aisles:",JSON.stringify(aisles));

const multi=lines.filter((l:any)=>new Set((l.uses||[]).map((u:any)=>u.label)).size>1);
console.log("lines merged from more than one recipe:",multi.length);
multi.forEach((l:any)=>console.log("   MERGED",l.label,"|",l.neededDisplay,"|",(l.uses||[]).map((u:any)=>u.label.slice(0,22)+" "+(u.display||"")).join(" + "),"| pkg:",l.packagesDisplay||"-","| leftover:",l.leftoverDisplay||"-"));
console.log("\nlines with no amount at all (neededDisplay falsy or 0):",lines.filter((l:any)=>!l.neededDisplay||/^0\b/.test(l.neededDisplay)).length);
console.log("\nALL LINES (aisle | needed | label | packages):");
lines.forEach((l:any)=>console.log(" ",(l.aisle||"-").padEnd(14),String(l.neededDisplay||"-").padEnd(14),l.label.padEnd(42),l.packagesDisplay||""));
const st=L("shopping_ticks").filter((t:any)=>t.family_id===FAM&&t.week_start==="2026-09-07"&&!t.deleted_at);
const keys=new Set(lines.map((l:any)=>l.key));
console.log("\nticks whose item_key is no longer a line on this week's list:",st.filter((t:any)=>!keys.has(t.item_key)).length,"of",st.length);
console.log("  orphans:",st.filter((t:any)=>!keys.has(t.item_key)).map((t:any)=>t.item_key).join(" | "));
