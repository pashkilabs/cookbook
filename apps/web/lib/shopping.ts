import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consolidate,
  createCatalog,
  parseIngredientList,
  recipesUsingLeftovers,
  significantLeftovers,
  type ConsolidationEntry,
  type ShoppingLine,
} from "@pashki/core";
import {
  catalogItemsFromRows,
  GROCERY_PACKAGE_COLUMNS,
  INGREDIENT_COLUMNS,
} from "@pashki/db/catalog";
import type { MeasurementSystem } from "@pashki/core";
import type { IsoDate } from "./week";

/**
 * A week's shopping, assembled from what is planned.
 *
 * **Nothing here merges, converts or formats anything.** `consolidate()` does all of it, and it
 * is the code this project has been protecting since the first session. This module's whole job
 * is to hand it the right inputs: the household's planned recipes with their scales, a catalog
 * built from the database, and the pantry.
 *
 * The catalog comes from `ingredients` and `grocery_packages`, not `SEED_CATALOG` — the catalog
 * is data, and this is the first thing in the product to read it as such.
 */
export interface ShoppingWeek {
  lines: ShoppingLine[];
  byAisle: Array<{ aisle: string; lines: ShoppingLine[] }>;
  leftovers: ShoppingLine[];
  suggestions: Array<{ id: string; title: string; uses: string[] }>;
  plannedCount: number;
  pantry: Array<{ id: string; name: string }>;
  ticked: Set<string>;
}

export async function buildShoppingWeek(
  supabase: SupabaseClient,
  familyId: string,
  weekStart: IsoDate,
  days: IsoDate[],
  /**
   * Which market's package sizes to offer. Comes from `families.measurement_system` through the
   * seam — display follows the household, not the recipe it typed or the catalog it shops from
   * (decisions §28).
   */
  system: MeasurementSystem = "us",
): Promise<{ week: ShoppingWeek | null; error: string | null }> {
  const [plan, ingredientRows, packageRows, pantryRows, tickRows] = await Promise.all([
    supabase
      .from("plan_entries")
      .select("id, date, scale, recipes!inner(id, title)")
      .eq("family_id", familyId)
      .gte("date", days[0]!)
      .lte("date", days[days.length - 1]!)
      .is("deleted_at", null)
      .order("date"),
    supabase.from("ingredients").select(INGREDIENT_COLUMNS),
    supabase.from("grocery_packages").select(GROCERY_PACKAGE_COLUMNS),
    supabase
      .from("pantry_items")
      .select("id, name, amount, unit")
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("shopping_ticks")
      .select("item_key")
      .eq("family_id", familyId)
      .eq("week_start", weekStart)
      .is("deleted_at", null),
  ]);

  /*
   * The catalog is an improvement, not a prerequisite.
   *
   * A failed catalog read used to take the whole list down — Stephen saw
   * "column ingredients.grams_each does not exist" and no shopping list at all, on a week he had
   * planned. But `consolidate` works without a catalog: it buckets by name, merges what shares a
   * unit, and simply cannot suggest package sizes or aisles. **A list of the right ingredients
   * with no package advice is worth a great deal more than an error message**, and the household
   * is standing in a shop.
   *
   * The plan itself is different: with no planned recipes there is nothing to show, so that
   * failure is still fatal and still reported.
   */
  const fatal = plan.error ?? pantryRows.error ?? tickRows.error;
  if (fatal) return { week: null, error: fatal.message };

  const catalogFailure = ingredientRows.error ?? packageRows.error;
  if (catalogFailure) {
    console.error(`[pashki] shopping list built without the catalog: ${catalogFailure.message}`);
  }

  const planned = (plan.data ?? []).map((entry) => ({
    id: entry.id as string,
    date: entry.date as string,
    scale: Number(entry.scale),
    recipe: entry.recipes as unknown as { id: string; title: string },
  }));

  // an empty catalog is a working catalog that knows nothing — every item falls through to its
  // own name, which is exactly the degraded behaviour wanted
  const catalog = createCatalog(
    catalogItemsFromRows(ingredientRows.data ?? [], packageRows.data ?? [], system),
  );

  if (planned.length === 0) {
    return {
      week: {
        lines: [], byAisle: [], leftovers: [], suggestions: [], plannedCount: 0,
        pantry: (pantryRows.data ?? []).map((row) => ({ id: row.id, name: row.name })),
        ticked: new Set((tickRows.data ?? []).map((row) => row.item_key)),
      },
      error: null,
    };
  }

  // one query for every planned recipe's lines, rather than one per recipe
  const recipeIds = [...new Set(planned.map((entry) => entry.recipe.id))];
  const { data: lineRows, error: lineError } = await supabase
    .from("recipe_ingredients")
    .select("recipe_id, position, amount, unit, item_text, note")
    .eq("family_id", familyId)
    .in("recipe_id", recipeIds)
    .is("deleted_at", null)
    .order("position");
  if (lineError) return { week: null, error: lineError.message };

  const byRecipe = new Map<string, string[]>();
  for (const row of lineRows ?? []) {
    const lines = byRecipe.get(row.recipe_id) ?? [];
    // Rebuilt into the text the parser reads, rather than hand-assembling a ParsedIngredient.
    // The stored row is already the parser's own output, so this round-trips through the one
    // implementation instead of creating a second, subtly different one in the app.
    lines.push(
      [row.amount === null ? "" : String(row.amount), row.unit ?? "", row.item_text]
        .filter(Boolean)
        .join(" ") + (row.note ? `, ${row.note}` : ""),
    );
    byRecipe.set(row.recipe_id, lines);
  }

  const entries: ConsolidationEntry[] = planned.map((entry) => ({
    label: entry.recipe.title,
    groupKey: entry.date,
    // the planner's scale feeds straight through: a 1.5× recipe buys 1.5×
    scale: entry.scale,
    ingredients: parseIngredientList(byRecipe.get(entry.recipe.id) ?? []),
  }));

  const pantry = (pantryRows.data ?? []).map((row) => ({
    name: row.name as string,
    ...(row.amount === null ? {} : { amount: Number(row.amount) }),
    ...(row.unit === null ? {} : { unit: row.unit as string }),
  }));

  // the same preference decides both halves: which sizes are on the shelf, and how the amounts
  // are written. Passing it to one and not the other is what produced "2.5 kg bag" above
  // "3 lb spare" (decisions §28).
  const lines = consolidate(entries, catalog, { pantry, deductPantry: true, system });
  const leftovers = significantLeftovers(lines);

  // Candidates are the household's other recipes — the ones not already planned this week.
  const { data: candidateRows } = await supabase
    .from("recipes")
    .select("id, title, recipe_ingredients(item_text)")
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .eq("status", "active")
    .not("id", "in", `(${recipeIds.join(",")})`)
    .limit(200);

  const candidates = (candidateRows ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    ingredients: ((row.recipe_ingredients ?? []) as Array<{ item_text: string }>).map((line) => ({
      item: line.item_text,
    })),
  }));

  const suggested = recipesUsingLeftovers(leftovers, candidates, catalog);

  return {
    week: {
      lines,
      byAisle: groupByAisle(lines),
      leftovers,
      suggestions: suggested.slice(0, 6).map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
        // which leftovers *this* recipe would use. The first version tested membership of the
        // leftover set rather than of this line, so any recipe using one leftover was listed as
        // using all of them.
        uses: leftovers
          .filter((line) =>
            recipe.ingredients.some((ing) => catalog.find(ing.item)?.key === line.key),
          )
          .map((line) => line.label),
      })),
      plannedCount: planned.length,
      pantry: (pantryRows.data ?? []).map((row) => ({ id: row.id, name: row.name })),
      ticked: new Set((tickRows.data ?? []).map((row) => row.item_key)),
    },
    error: null,
  };
}

/**
 * `consolidate()` already returns lines sorted by `AISLE_ORDER`, so this only has to break the
 * run into groups — it must not re-sort, or it would be deciding aisle order in the app.
 */
function groupByAisle(lines: ShoppingLine[]): Array<{ aisle: string; lines: ShoppingLine[] }> {
  const groups: Array<{ aisle: string; lines: ShoppingLine[] }> = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.aisle === line.aisle) last.lines.push(line);
    else groups.push({ aisle: line.aisle, lines: [line] });
  }
  return groups;
}
