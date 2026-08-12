/**
 * Tier 0: the machine-readable recipe data a page publishes.
 *
 * Free, instant, and more accurate than any model, because it is what the site
 * said rather than an interpretation of it (decisions §6). This is the tier whose
 * hit rate matters more than model choice.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

const SCRIPT = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Every ld+json block on the page, parsed. Unparseable blocks are skipped, not fatal. */
export function collectJsonLd(html: string): JsonValue[] {
  const found: JsonValue[] = [];
  for (const match of String(html ?? "").matchAll(SCRIPT)) {
    const raw = (match[1] ?? "")
      // often written as //<![CDATA[ or /*<![CDATA[*/ so the block is also valid JS
      .replace(/^\s*(?:\/\/|\/\*)?\s*<!\[CDATA\[\s*(?:\*\/)?/, "")
      .replace(/(?:\/\*)?\s*\]\]>\s*(?:\*\/|\/\/)?\s*$/, "")
      .trim();
    if (!raw) continue;
    try {
      found.push(JSON.parse(raw) as JsonValue);
    } catch {
      // one malformed block must not cost us the others; plenty of sites ship both
      // a broken analytics blob and a perfectly good Recipe
    }
  }
  return found;
}

/** Flatten documents, arrays and `@graph` containers into a single list of nodes. */
export function flattenNodes(documents: JsonValue[]): JsonObject[] {
  const nodes: JsonObject[] = [];

  const walk = (value: JsonValue): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isObject(value)) return;

    nodes.push(value);
    // @graph is the common container; nested objects can also hold a Recipe, e.g.
    // a WebPage whose mainEntity is the recipe
    for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement"]) {
      const nested = value[key];
      if (nested !== undefined) walk(nested);
    }
  };

  for (const document of documents) walk(document);
  return nodes;
}

/**
 * Index nodes by `@id` so references can be resolved.
 *
 * **A bare reference must never overwrite the real node it points at.** Sites
 * routinely write `"image": {"@id": "…#primaryimage"}` and then define the actual
 * ImageObject elsewhere in the same graph. Both appear in the node list, and if the
 * reference happens to come second, a naive index ends up mapping the id to an
 * object containing nothing but that id — and the image silently disappears.
 *
 * So the richer node wins, regardless of order.
 */
export function buildNodeIndex(nodes: JsonObject[]): Map<string, JsonObject> {
  const index = new Map<string, JsonObject>();
  for (const node of nodes) {
    const id = typeof node["@id"] === "string" ? node["@id"] : null;
    if (!id) continue;
    const existing = index.get(id);
    if (!existing || informationCount(node) > informationCount(existing)) {
      index.set(id, node);
    }
  }
  return index;
}

/** A node carrying only `@id`, or `@id` and `@type`, states nothing. */
export function isBareReference(node: JsonObject): boolean {
  return Object.keys(node).every((key) => key === "@id" || key === "@type");
}

function informationCount(node: JsonObject): number {
  return Object.keys(node).filter((key) => key !== "@id" && key !== "@type").length;
}

/**
 * Follow a value that might be a reference into the graph.
 *
 * Returns the referenced node when the value is a bare `{"@id": …}` and the graph
 * defines it. A reference that resolves to nothing stays as it was, so a caller can
 * still see what was pointed at.
 */
export function resolveRef(value: JsonValue, index: Map<string, JsonObject>): JsonValue {
  if (!isObject(value)) return value;
  const id = typeof value["@id"] === "string" ? value["@id"] : null;
  if (!id || !isBareReference(value)) return value;
  const target = index.get(id);
  // don't resolve a reference to itself
  return target && !isBareReference(target) ? target : value;
}

export function typesOf(node: JsonObject): string[] {
  const type = node["@type"];
  const list = Array.isArray(type) ? type : [type];
  return list.filter((value): value is string => typeof value === "string");
}

/** The first node that declares itself a Recipe. */
export function findRecipeNode(nodes: JsonObject[]): JsonObject | null {
  for (const node of nodes) {
    if (typesOf(node).some((type) => type.toLowerCase() === "recipe")) return node;
  }
  return null;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First string in a value that might be a string, an array, or an object with a text field. */
export function firstString(value: JsonValue | undefined, keys = ["name", "text", "url"]): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, keys);
      if (found) return found;
    }
    return null;
  }
  if (isObject(value)) {
    for (const key of keys) {
      const found = firstString(value[key], keys);
      if (found) return found;
    }
  }
  return null;
}
