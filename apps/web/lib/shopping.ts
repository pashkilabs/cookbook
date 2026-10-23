import { maybeRow, rows } from "./rows";
import { platformStore } from "./platform";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consolidate,
  createCatalog,
  linesCoveredByBase,
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
  /**
   * What somebody typed onto this week's list, for the control that lists and removes them.
   *
   * Separate from `lines` on purpose: a line is a *thing to buy*, already merged with whatever the
   * recipes asked for, and an extra is a *request somebody made*. Two people asking for milk is
   * two requests and one carton, and only the first of those is editable.
   */
  extras: Array<{ id: string; text: string; addedBy: string }>;
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
  const [plan, ingredientRows, packageRows, pantryRows, tickRows, extraRows] = await Promise.all([
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
    /*
     * Week-scoped, like the ticks beside it — that is what makes nothing have to clear them.
     * `family_members` is a platform table, so the name comes through the seam below rather than
     * from an embedded resource here; `check-platform-tables.mjs` fails the build on a join.
     */
    supabase
      .from("shopping_extras")
      .select("id, raw_text, added_by")
      .eq("family_id", familyId)
      .eq("week_start", weekStart)
      .is("deleted_at", null)
      .order("created_at"),
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
  /*
   * A failed extras read is **fatal**, unlike the catalog.
   *
   * A list missing package advice is still the right ingredients; a list silently missing the
   * thing somebody typed an hour ago is a list that lies, and they will not buy it. Absence and
   * never-added are indistinguishable on a shopping screen.
   */
  const fatal = plan.error ?? pantryRows.error ?? tickRows.error ?? extraRows.error;
  if (fatal) return { week: null, error: fatal.message };

  const catalogFailure = ingredientRows.error ?? packageRows.error;
  if (catalogFailure) {
    console.error(`[pashki] shopping list built without the catalog: ${catalogFailure.message}`);
  }

  /*
   * Who asked, by name, through the seam — `family_members` is a platform table.
   *
   * The name becomes the entry's `label`, which lands in `ShoppingLine.uses`: the field the screen
   * already uses to say which meals want an ingredient. So a merged line reads "Cream — Tuesday's
   * carbonara, Friday's tart, Paige" with no new UI at all.
   *
   * No export sends `uses` — `instacart.ts` sends `display_text: line.label` and nothing else —
   * so a household name does not leave on a cart. Recorded rather than assumed, and if an export
   * ever carries `uses` it would then be sending both recipe titles and household names to a
   * third party, which is a decision to take deliberately.
   */
  const extras = (extraRows.data ?? []).map((row) => ({
    id: row.id as string,
    text: row.raw_text as string,
    addedById: row.added_by as string,
  }));
  const memberNames = new Map<string, string>(
    extras.length === 0
      ? []
      : (await platformStore().listMembers(familyId)).map((member) => [member.id, member.displayName]),
  );

  /*
   * One definition, two call sites — the empty-plan branch below needs these too.
   *
   * A household that has planned nothing and typed "milk" must still see milk: the first version
   * returned early on an empty plan and the typed item vanished, which is the silent-drop shape
   * (§80) arriving through a branch written before the feature existed.
   *
   * Grouped by person so the `uses` row says who asked.
   */
  const extraEntries = (): ConsolidationEntry[] => {
    const byPerson = new Map<string, string[]>();
    for (const extra of extras) {
      const texts = byPerson.get(extra.addedById) ?? [];
      texts.push(extra.text);
      byPerson.set(extra.addedById, texts);
    }
    /*
     * **No `groupKey`.** An extra is not on a day, and the first version set it to the string
     * `"added"` — which 500'd the whole screen, because `ShoppingList` renders every `groupKey`
     * through `weekdayName(...).slice(0, 3)` and had never met one that was not a date.
     *
     * Each half was right: the entry is well formed, `consolidate` buckets it correctly, the row
     * renders. The **handoff** was broken, which is the join a component test cannot see — and
     * this value crosses three boundaries (route → table → consolidate → screen), which is this
     * project's own trigger for one test that walks the whole path.
     *
     * With it absent the chip falls back to `use.label`, which is the person's name: "Paige · 2".
     * That is the right thing to show for something nobody put on a day.
     */
    return [...byPerson].map(([memberId, texts]) => ({
      label: memberNames.get(memberId) ?? "Added by hand",
      ingredients: parseIngredientList(texts),
      keepStaples: true,
    }));
  };

  const asExtras = () =>
    extras.map((extra) => ({
      id: extra.id,
      text: extra.text,
      addedBy: memberNames.get(extra.addedById) ?? "someone",
    }));

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
    // typed items still have to appear — see `extraEntries`
    const only = consolidate(extraEntries(), catalog, { system });
    return {
      week: {
        lines: only,
        extras: asExtras(),
        byAisle: groupByAisle(only),
        leftovers: [], suggestions: [], plannedCount: 0,
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

  /*
   * Bases held in the freezer, and the lines they take off the list.
   *
   * A base is a pantry item that remembers which part of which recipe it is (§69), so the lines
   * it covers are looked up rather than matched by name — which is what §64 measured as
   * impossible for a name somebody typed.
   *
   * `amount` counts batches, so a base covers that many *occurrences*. Two batches of dressing
   * and the salad planned three times buys the dressing once. The decrement happens when a meal
   * is cooked, not here: planning is not using.
   */
  const baseRows = rows(
    await supabase
      .from("pantry_items")
      .select("from_recipe_id, from_component, amount")
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .not("from_recipe_id", "is", null),
    "bases held",
  );
  const batchesLeft = new Map<string, number>();
  for (const row of baseRows) {
    const key = `${row.from_recipe_id}|${String(row.from_component).toLowerCase()}`;
    batchesLeft.set(key, (batchesLeft.get(key) ?? 0) + Math.floor(Number(row.amount ?? 0)));
  }

  const componentsOf = new Map(
    rows(
      await supabase
        .from("recipes")
        .select("id, components")
        .eq("family_id", familyId)
        .in("id", recipeIds)
        .not("components", "is", null),
      "components for bases",
    ).map((row) => [row.id as string, row.components]),
  );

  const entries: ConsolidationEntry[] = planned.map((entry) => {
    const lines = byRecipe.get(entry.recipe.id) ?? [];
    const parsed = parseIngredientList(lines);

    // every base this recipe has a batch left of, applied once per occurrence
    const covered = new Set<number>();
    const components = componentsOf.get(entry.recipe.id);
    for (const [key, left] of batchesLeft) {
      const [recipeId, componentName] = key.split("|");
      if (recipeId !== entry.recipe.id || left < 1) continue;
      const theseLines = linesCoveredByBase(components, componentName ?? "", lines.length);
      if (theseLines.size === 0) continue;
      for (const at of theseLines) covered.add(at);
      batchesLeft.set(key, left - 1);
    }

    return {
      label: entry.recipe.title,
      groupKey: entry.date,
      // the planner's scale feeds straight through: a 1.5× recipe buys 1.5×
      scale: entry.scale,
      ingredients: covered.size === 0 ? parsed : parsed.filter((_, at) => !covered.has(at)),
    };
  });

  const pantry = (pantryRows.data ?? []).map((row) => ({
    name: row.name as string,
    ...(row.amount === null ? {} : { amount: Number(row.amount) }),
    ...(row.unit === null ? {} : { unit: row.unit as string }),
  }));

  // the same preference decides both halves: which sizes are on the shelf, and how the amounts
  // are written. Passing it to one and not the other is what produced "2.5 kg bag" above
  // "3 lb spare" (decisions §28).
  /*
   * Typed extras, one entry per person, appended to the planned meals.
   *
   * **One `consolidate` call, not two.** Everything the feature needs falls out of that: an extra
   * naming a catalog item shares the recipes' bucket, so "1 pint cream" typed on Monday buys one
   * carton across Tuesday and Friday rather than a second; an extra naming nothing recognisable
   * falls through to its own line with no package advice, in the words that were typed; and the
   * tick key is the consolidated key either way, so ticking the cream ticks all of it.
   *
   * Grouped by person so the `uses` row says who, and `keepStaples` because somebody who typed
   * "salt" has run out of salt — the default drops it, silently, which is the fault the design
   * pass found by running this rather than reading it.
   */
  entries.push(...extraEntries());

  const lines = consolidate(entries, catalog, { pantry, deductPantry: true, system });
  const leftovers = significantLeftovers(lines);

  // Candidates are the household's other recipes — the ones not already planned this week.
  const candidateRows = rows(
    await supabase
    .from("recipes")
    .select("id, title, recipe_ingredients(item_text)")
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .eq("status", "active")
    .not("id", "in", `(${recipeIds.join(",")})`)
    .limit(200),
    "candidateRows",
  );

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
      extras: asExtras(),
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
