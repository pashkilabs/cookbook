import { stripTags } from "@pashki/core";
import type { JsonObject } from "./jsonld.js";

/**
 * Tier 1: microdata attributes and recipe-plugin markup.
 *
 * For pages that render a recipe card without publishing structured data. Still
 * deterministic and still free — it reads what the page marked up.
 *
 * Regex rather than a DOM parser. That is a real tradeoff: it cannot handle nesting,
 * so a section heading inside an ingredient list looks like an ingredient. The
 * ingredient parser already discards non-ingredients, and adding a DOM dependency to
 * win the remaining cases is a decision better made against real fixtures than in
 * advance.
 */

/** `<x itemprop="name">value</x>` — innermost match, so nested markup is not swallowed. */
function itemprop(html: string, prop: string): string[] {
  const pattern = new RegExp(
    String.raw`<([a-z0-9]+)[^>]*itemprop=["'][^"']*\b${prop}\b[^"']*["'][^>]*>([\s\S]*?)</\1>`,
    "gi",
  );
  const values: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const text = stripTags(match[2] ?? "").trim();
    if (text) values.push(text);
  }
  return values;
}

/** `<meta itemprop="x" content="y">` and `<x itemprop="y" content="z">`. */
function itempropContent(html: string, prop: string): string[] {
  const pattern = new RegExp(
    String.raw`<[a-z0-9]+[^>]*itemprop=["'][^"']*\b${prop}\b[^"']*["'][^>]*\bcontent=["']([^"']*)["']`,
    "gi",
  );
  const values: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const text = (match[1] ?? "").trim();
    if (text) values.push(text);
  }
  return values;
}

/** Class-based markup from the common recipe plugins, for pages with no microdata. */
function byClass(html: string, className: string): string[] {
  const pattern = new RegExp(
    String.raw`<([a-z0-9]+)[^>]*class=["'][^"']*\b${className}\b[^"']*["'][^>]*>([\s\S]*?)</\1>`,
    "gi",
  );
  const values: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const text = stripTags(match[2] ?? "").trim();
    if (text) values.push(text);
  }
  return values;
}

const first = (values: string[]): string | null => values[0] ?? null;

/**
 * Read a recipe out of markup, as a node shaped like the JSON-LD one so both tiers
 * feed the same mapper. Returns null when there is nothing recipe-shaped here.
 */
export function extractMicrodata(html: string): JsonObject | null {
  const source = String(html ?? "");

  const ingredients = [
    ...itemprop(source, "recipeIngredient"),
    ...itemprop(source, "ingredients"),
    // WP Recipe Maker, Tasty Recipes, Mediavine Create
    ...byClass(source, "wprm-recipe-ingredient"),
    ...byClass(source, "tasty-recipes-ingredients"),
    ...byClass(source, "mv-create-ingredients"),
  ];
  if (ingredients.length === 0) return null;

  const steps = [
    ...itemprop(source, "recipeInstructions"),
    ...byClass(source, "wprm-recipe-instruction-text"),
    ...byClass(source, "tasty-recipes-instructions"),
  ];

  const name =
    first(itemprop(source, "name")) ??
    first(byClass(source, "wprm-recipe-name")) ??
    first(byClass(source, "tasty-recipes-title")) ??
    // the page title is a poor last resort, but a recipe with no title at all is
    // rejected downstream and a wrong-ish title is reviewable
    first([...source.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1] ?? "")));

  const yieldValue =
    first(itempropContent(source, "recipeYield")) ??
    first(itemprop(source, "recipeYield")) ??
    first(byClass(source, "wprm-recipe-servings"));

  const totalTime =
    first(itempropContent(source, "totalTime")) ?? first(itemprop(source, "totalTime"));
  const prepTime =
    first(itempropContent(source, "prepTime")) ?? first(itemprop(source, "prepTime"));
  const cookTime =
    first(itempropContent(source, "cookTime")) ?? first(itemprop(source, "cookTime"));

  // an itemprop="image" is usually an <img>, whose text content is empty, so the
  // attribute forms have to be read directly
  const image =
    first(itempropContent(source, "image")) ??
    first(
      [...source.matchAll(/<img[^>]*itemprop=["'][^"']*\bimage\b[^"']*["'][^>]*>/gi)].flatMap(
        (m) => {
          const src = /\bsrc=["']([^"']+)["']/i.exec(m[0] ?? "");
          return src?.[1] ? [src[1]] : [];
        },
      ),
    ) ??
    // og:image is not microdata, but it is what these pages actually have
    first(
      [
        ...source.matchAll(
          /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/gi,
        ),
      ].flatMap((m) => (m[1] ? [m[1]] : [])),
    );

  const node: JsonObject = {
    "@type": "Recipe",
    recipeIngredient: ingredients,
  };
  if (name) node.name = name;
  if (steps.length > 0) node.recipeInstructions = steps;
  if (yieldValue) node.recipeYield = yieldValue;
  if (totalTime) node.totalTime = totalTime;
  if (prepTime) node.prepTime = prepTime;
  if (cookTime) node.cookTime = cookTime;
  if (image) node.image = image;

  return node;
}

/** `<meta property="og:site_name">`, for attribution. */
export function extractSiteName(html: string): string | null {
  const og = /<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i.exec(
    String(html ?? ""),
  );
  return og?.[1]?.trim() || null;
}
