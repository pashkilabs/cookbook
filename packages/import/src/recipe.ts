import { parseIngredientList, stripTags } from "@pashki/core";
import type { ExtractedRecipe } from "./types.js";
import {
  firstString,
  isBareReference,
  isObject,
  resolveRef,
  type JsonObject,
  type JsonValue,
} from "./jsonld.js";
import { absoluteUrl } from "./url.js";

/**
 * ISO 8601 duration to minutes. `PT1H20M` is 80.
 *
 * Minutes because a number can be compared and scaled and "1 hr 20" cannot — the
 * same reasoning as base units in packages/core.
 */
export function durationToMinutes(value: JsonValue | undefined): number | null {
  const text = typeof value === "string" ? value.trim() : null;
  if (!text) return null;

  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/i.exec(text);
  if (iso) {
    const [, days, hours, minutes, seconds] = iso;
    const total =
      Number(days ?? 0) * 1440 +
      Number(hours ?? 0) * 60 +
      Number(minutes ?? 0) +
      Number(seconds ?? 0) / 60;
    return total > 0 ? Math.round(total) : null;
  }

  // some sites write plain text in a duration field
  const written = /(\d+)\s*(?:hours?|hrs?|h)\b/i.exec(text);
  const writtenMinutes = /(\d+)\s*(?:minutes?|mins?|m)\b/i.exec(text);
  if (written || writtenMinutes) {
    const total = Number(written?.[1] ?? 0) * 60 + Number(writtenMinutes?.[1] ?? 0);
    return total > 0 ? total : null;
  }

  const bare = Number(text);
  return Number.isFinite(bare) && bare > 0 ? Math.round(bare) : null;
}

/**
 * `recipeYield` is written every way imaginable: `4`, `"4"`, `"4 servings"`,
 * `"Serves 4-6"`, `["4", "4 servings"]`. Take the first number found, and the upper
 * bound of a range — the same convention the ingredient parser uses, so a household
 * is not left short.
 */
export function parseServings(value: JsonValue | undefined): number | null {
  const text = firstString(value);
  if (!text) return null;
  const range = /(\d+)\s*(?:-|–|—|to)\s*(\d+)/.exec(text);
  if (range) return Math.max(Number(range[1]), Number(range[2]));
  const single = /(\d+)/.exec(text);
  if (!single) return null;
  const parsed = Number(single[1]);
  return parsed > 0 ? parsed : null;
}

/**
 * Flatten `recipeInstructions` into ordered steps.
 *
 * Real pages use all of: one string with newlines, an array of strings, an array of
 * HowToStep objects, and an array of HowToSection each wrapping its own
 * itemListElement. Sections lose their headings here — a heading is not a step, and
 * the schema has nowhere to put one.
 */
export function parseSteps(value: JsonValue | undefined): string[] {
  const steps: string[] = [];

  const walk = (node: JsonValue | undefined): void => {
    if (node === undefined || node === null) return;
    if (typeof node === "string") {
      // Split before stripping, not after: stripTags collapses all whitespace
      // including newlines, so stripping first destroys the only thing separating
      // one step from the next.
      for (const piece of splitLines(node)) steps.push(piece);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isObject(node)) return;

    // a section: descend into its own list rather than reading its name
    if (node.itemListElement !== undefined) {
      walk(node.itemListElement);
      return;
    }
    const text = firstString(node, ["text", "name"]);
    if (text) {
      for (const piece of splitLines(text)) steps.push(piece);
    }
  };

  walk(value);
  return steps;
}

/**
 * The image, resolving a reference into the graph.
 *
 * Recipe data commonly writes `"image": {"@id": "…#primaryimage"}` and defines the
 * real ImageObject elsewhere. Downloading the pointer fetches an HTML page or a 404;
 * the reference has to be followed first.
 */
export function parseImageUrl(
  value: JsonValue | undefined,
  index: Map<string, JsonObject>,
  base: string,
): string | null {
  if (value === undefined) return null;

  const candidates: JsonValue[] = Array.isArray(value) ? value : [value];

  // First pass: real image fields only. A reference that resolved to nothing is
  // skipped here rather than having its @id treated as a URL — "#primaryimage"
  // resolved against the page is a link to the page, not to an image.
  for (const candidate of candidates) {
    const resolved = resolveRef(candidate, index);
    if (isObject(resolved) && isBareReference(resolved)) continue;
    const url = firstString(resolved, ["url", "contentUrl"]);
    const absolute = url ? absoluteUrl(url, base) : null;
    if (absolute) return absolute;
  }

  // Second pass: some sites do write the URL as the @id. Only now, once no
  // candidate offered a real field.
  for (const candidate of candidates) {
    const url = firstString(resolveRef(candidate, index), ["@id"]);
    const absolute = url ? absoluteUrl(url, base) : null;
    // a fragment-only id is a graph reference, never an image
    if (absolute && !url!.startsWith("#")) return absolute;
  }
  return null;
}

export interface MapOptions {
  node: JsonObject;
  index: Map<string, JsonObject>;
  /** the page URL after redirects, so relative links resolve correctly */
  baseUrl: string;
  sourceUrl: string;
  sourceName: string | null;
}

/** A JSON-LD Recipe node to the shape the review screen and the schema expect. */
export function mapRecipeNode(options: MapOptions): ExtractedRecipe {
  const { node, index, baseUrl } = options;

  const title = firstString(node.name) ?? firstString(node.headline) ?? "";

  const ingredientLines = toStringArray(node.recipeIngredient ?? node.ingredients);

  const totalMinutes =
    durationToMinutes(node.totalTime) ??
    sumOrNull(durationToMinutes(node.prepTime), durationToMinutes(node.cookTime));

  return {
    title: stripTags(title).trim(),
    servings: parseServings(node.recipeYield),
    totalMinutes,
    // the parser drops anything that isn't an ingredient, so headings in the list
    // do not become phantom rows
    ingredients: parseIngredientList(ingredientLines),
    steps: parseSteps(node.recipeInstructions),
    imageUrl: parseImageUrl(node.image, index, baseUrl),
    sourceUrl: options.sourceUrl,
    sourceName: options.sourceName,
  };
}

/**
 * One string into trimmed lines, tags removed.
 *
 * `stripTags` replaces each tag with a space, which leaves "onion ." where an inline
 * `<b>` closed before the full stop — so the space before punctuation is closed up
 * afterwards.
 */
function splitLines(value: string): string[] {
  return String(value)
    .split(/\r?\n+|<br\s*\/?>|<\/li>|<\/p>/i)
    .map((piece) => stripTags(piece).replace(/\s+([.,;:!?])/g, "$1").trim())
    .filter((piece) => piece.length > 0);
}

function sumOrNull(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export function toStringArray(value: JsonValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return splitLines(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = firstString(item, ["text", "name"]);
      return text ? [text] : [];
    });
  }
  const text = firstString(value, ["text", "name"]);
  return text ? [text] : [];
}

/** What a recipe must have before it is worth showing somebody. */
export function missingFields(recipe: ExtractedRecipe): string[] {
  const missing: string[] = [];
  if (!recipe.title) missing.push("title");
  if (recipe.ingredients.length === 0) missing.push("ingredients");
  return missing;
}
