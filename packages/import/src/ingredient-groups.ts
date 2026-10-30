import { parseIngredientList, stripTags, type ParsedIngredient } from "@pashki/core";

/**
 * Ingredient group headings, read from the card's DOM.
 *
 * ---------------------------------------------------------------------------
 * Why the DOM, when every other field comes from structured data
 * ---------------------------------------------------------------------------
 *
 * **schema.org cannot carry this.** `recipeIngredient` is a flat array of strings with no concept
 * of grouping, so a page that writes "Sauce", "Mini Meatballs" and "Pasta, etc." above three runs
 * of ingredients publishes nineteen strings and nothing about the three headings. Measured on both
 * reported recipes and on every sourced recipe in the library: the JSON-LD never contains them and
 * the card's DOM always does.
 *
 * That makes this the one field where the deterministic tier has to read markup rather than data.
 * Everything downstream was already built and waiting — `recipe_ingredients.section` has existed
 * since `20260909090000`, `parseIngredientList` turns a heading into a section on the run that
 * follows, and both the recipe page and cook mode render contiguous runs. The only thing missing
 * was capture, which is why this is a reader and not a feature.
 *
 * ---------------------------------------------------------------------------
 * Structural assignment, not a heading line pushed through the text channel
 * ---------------------------------------------------------------------------
 *
 * The obvious shape is to splice `"Sauce:"` into the ingredient array and let `parseIngredientList`
 * do the rest, since it already handles exactly that. It is the wrong shape here, and the reason is
 * worth keeping: `headingOf` requires a trailing colon and **rejects any candidate containing a
 * quantity**, because in free text a line like `2 cups flour:` is an ingredient. Those heuristics
 * exist for an ambiguous channel. The DOM is not ambiguous — an `<h4>` inside an ingredient-group
 * container is a heading by construction.
 *
 * Routed through the text channel, the real heading
 * `"For Sauce (Or you may substitute 3-4 cups of your favorite, quality marinara sauce)"` would be
 * refused for containing "3-4 cups" and would then **parse as an ingredient**, putting a sentence
 * of prose on somebody's shopping list. An ingredient read as a heading merely disappears; a
 * heading read as an ingredient gets bought.
 *
 * ---------------------------------------------------------------------------
 * Regex rather than a DOM parser, and what makes that safe
 * ---------------------------------------------------------------------------
 *
 * Following `microdata.ts`, which made the same tradeoff deliberately. A regex cannot see nesting,
 * so the last group's item count can run past the end of its list and pick up markup after it.
 *
 * **The alignment check is what makes that acceptable.** The group sizes must sum to exactly the
 * number of ingredients the structured data published; an over-count fails that and the recipe is
 * stored flat. So the imprecision costs a missed grouping, never a wrong one — which is the right
 * direction, because a heading over the wrong run tells the cook to put the parmesan in the
 * marinade.
 */
export interface IngredientGroup {
  /**
   * The heading as the page wrote it, less a trailing colon — or null for a run the page did not
   * name.
   *
   * **Unnamed runs are counted, and that is the whole reason this is nullable.** Cards commonly
   * put a few ingredients before the first heading, and an earlier version of this skipped those
   * blocks: their rows then went missing from the total, the alignment check failed, and a recipe
   * with one ungrouped line at the top lost *every* section it had. Counting them with a null
   * heading keeps the arithmetic honest and stores those lines exactly as an ungrouped recipe
   * stores them, which is what they are.
   */
  heading: string | null;
  /** how many ingredient rows sit under it */
  items: number;
}

/** the CHECK on `recipe_ingredients.section`; clamped here so a long heading cannot fail a save */
const MAX_SECTION = 200;

const GROUP_BLOCK =
  /<(div|li)[^>]*class="[^"]*ingredient-group[^"]*"[^>]*>([\s\S]*?)(?=<\1[^>]*class="[^"]*ingredient-group|$)/gi;
const GROUP_HEADING = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;
const GROUP_ITEM = /<li[^>]*class="[^"]*ingredient[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;

/**
 * Every run of ingredients the card declares, in page order, with the size of each.
 *
 * A block with no items is not a run — a heading with nothing under it appears on real cards as a
 * wrapper. A block with items and no heading **is** a run, carrying null: see `heading` above.
 */
export function ingredientGroups(html: string): IngredientGroup[] {
  const groups: IngredientGroup[] = [];
  for (const block of html.matchAll(GROUP_BLOCK)) {
    const inner = block[2] ?? "";
    const label = stripTags(GROUP_HEADING.exec(inner)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/:$/, "")
      .trim()
      .slice(0, MAX_SECTION);
    const items = [...inner.matchAll(GROUP_ITEM)].length;
    if (!items) continue;
    groups.push({ heading: label || null, items });
  }
  return groups;
}

export interface SectionedIngredients {
  ingredients: ParsedIngredient[];
  /** how many groups the page declared; 0 when it declares none */
  groups: number;
  /** false when the page grouped its ingredients and the counts did not line up */
  aligned: boolean;
  /** why the grouping was not used, for the import log; null when nothing was wrong */
  note: string | null;
}

/**
 * Ingredient lines with their section, when the page's grouping can be trusted.
 *
 * A section is a **contiguous run in source order** — measured, not assumed: across every sourced
 * recipe in the real library, 8 of 8 that declare groups have sizes summing exactly to the
 * published ingredient count, and the two reported recipes slice at indices 0/6/13 and 0/7/12.
 * That is what lets each group's slice be parsed on its own, which also survives the parser
 * dropping a line it cannot read: a dropped line shortens its own group and moves nothing.
 *
 * One group is not a grouping. A card that wraps its whole list in a single named container is
 * describing the list, not dividing it, so it is left flat.
 */
export function sectionedIngredients(lines: readonly string[], html: string): SectionedIngredients {
  const flat = () => parseIngredientList([...lines]);
  const groups = ingredientGroups(html);
  const named = groups.filter((g) => g.heading !== null).length;

  // one run is a list with a title, not a division; no named run is not a grouping at all
  if (groups.length < 2 || named === 0) {
    return { ingredients: flat(), groups: named, aligned: true, note: null };
  }

  const total = groups.reduce((sum, g) => sum + g.items, 0);
  if (total !== lines.length) {
    return {
      ingredients: flat(),
      groups: named,
      aligned: false,
      note:
        `${groups.length} ingredient groups totalling ${total} rows, but the structured data ` +
        `published ${lines.length} ingredients — stored flat, because a heading over the wrong ` +
        `run is worse than no heading`,
    };
  }

  const ingredients: ParsedIngredient[] = [];
  let at = 0;
  for (const group of groups) {
    const slice = [...lines].slice(at, at + group.items);
    at += group.items;
    for (const parsed of parseIngredientList(slice)) {
      // the block's heading wins: a run's own text cannot contain a heading, the DOM said so.
      // A null heading leaves the line exactly as an ungrouped recipe stores it.
      ingredients.push(group.heading === null ? parsed : { ...parsed, section: group.heading });
    }
  }
  return { ingredients, groups: named, aligned: true, note: null };
}
