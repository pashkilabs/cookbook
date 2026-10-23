import { describe, expect, it } from "vitest";
import {
  SHOPPING_PHOTO_INSTRUCTIONS,
  SHOPPING_PHOTO_JSON_SCHEMA,
  readShoppingList,
} from "../src/shopping-photo.js";

const line = (over: Record<string, unknown> = {}) => ({
  text: "bread",
  struck: false,
  strikeConfidence: "certain",
  legible: true,
  ...over,
});

const reader = (json: unknown) => ({
  visionModels: [{ model: "a-model" }],
  visionProvider: { extract: async () => ({ json }) },
});

const png = { bytes: new Uint8Array([1]), mediaType: "image/png" as const };

describe("reading a shopping list off a photograph", () => {
  it("reads a line that is only an item name, which is most of them", async () => {
    const out = await readShoppingList({ images: [png], cascade: reader({ lines: [line()] }) });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.lines[0]).toEqual(line());
  });

  it("keeps a crossed-out line and marks it, rather than dropping it", async () => {
    const out = await readShoppingList({
      images: [png],
      cascade: reader({ lines: [line({ text: "milk", struck: true, strikeConfidence: "unsure" })] }),
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.lines[0]?.struck).toBe(true);
      expect(out.lines[0]?.strikeConfidence).toBe("unsure");
    }
  });

  /*
   * The least visible failure this path has. A reading that returns `text` and drops `struck`
   * gives a crossed-out item back as an ordinary one — indistinguishable from a correct read, and
   * the person finds out in the shop. Rejecting sends the cascade to the next model instead.
   */
  // regression: an unvalidated field is an unasked one (§54)
  it("refuses a line missing any field it asked for", async () => {
    for (const missing of ["struck", "strikeConfidence", "legible", "text"]) {
      const partial = line();
      delete (partial as Record<string, unknown>)[missing];
      const out = await readShoppingList({ images: [png], cascade: reader({ lines: [partial] }) });
      expect(out.ok, `a line with no ${missing} was accepted`).toBe(false);
    }
  });

  it("refuses a strikeConfidence outside the two it offered", async () => {
    const out = await readShoppingList({
      images: [png],
      cascade: reader({ lines: [line({ strikeConfidence: "maybe" })] }),
    });
    expect(out.ok).toBe(false);
  });

  it("accepts an empty list, because a photograph may hold no list at all", async () => {
    const out = await readShoppingList({ images: [png], cascade: reader({ lines: [] }) });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.lines).toEqual([]);
  });

  /*
   * A refusal, never a fall back to a text model that cannot see — the difference between "we
   * could not read it" and "we read it and it was blank", which a review screen renders
   * identically unless it survives this far (§80).
   */
  it("refuses rather than guessing when no vision model is configured", async () => {
    const out = await readShoppingList({ images: [png], cascade: { visionModels: [] } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("not-configured");
  });

  it("says so when there is nothing to read", async () => {
    const out = await readShoppingList({ images: [], cascade: reader({ lines: [line()] }) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no-images");
  });

  /*
   * §54a: an example in a description is a silent default, and the component-name example was
   * itself the bug once. Most lines on a shopping list carry no quantity, so an example with one
   * would teach quantities onto lines that have none.
   */
  it("shows an unquantified example, and says in words that most lines have none", () => {
    const text = JSON.stringify(SHOPPING_PHOTO_JSON_SCHEMA);
    const example = text.match(/Often just an item[^"]*/)?.[0] ?? "";
    expect(example).not.toMatch(/\d/);
    expect(SHOPPING_PHOTO_INSTRUCTIONS).toContain("MOST LINES HAVE NO QUANTITY");
    expect(SHOPPING_PHOTO_INSTRUCTIONS).toMatch(/NEVER leave a crossed-out line out/);
  });
});
