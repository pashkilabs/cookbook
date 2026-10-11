import { describe, expect, it } from "vitest";
import { foldForSearch, normaliseName } from "../src/index.js";

/*
 * regression: `normaliseName` stripped every letter outside a-z.
 *
 * `jalapeño` became `jalape o` and `bräserad rödkål` became `br serad r dk l` — the character
 * removed rather than replaced. Found by asking Kroger's catalogue about the real library (§75),
 * which is the first thing outside this app ever asked to recognise these names.
 *
 * **Nothing stored was corrupted**: `item_text` holds the parser's output, which was always
 * intact — 8 rows carry non-ASCII characters and 0 are damaged. The damage is at *read* time, and
 * `consolidate` makes it visible in the one place that matters: `label` is
 * `normaliseName(item) || item`, so a shopping list displayed `jalape o`.
 */
describe("a letter outside a-z is still a letter", () => {
  it("keeps the ñ in jalapeño", () => {
    expect(normaliseName("jalapeño")).toBe("jalapeño");
  });

  it("keeps Swedish vowels, which a whole set of this library's recipes are written in", () => {
    expect(normaliseName("bräserad rödkål")).toBe("bräserad rödkål");
    expect(normaliseName("äppelmust")).toBe("äppelmust");
  });

  it("keeps French and Spanish accents", () => {
    expect(normaliseName("crème fraîche")).toBe("crème fraîche");
    expect(normaliseName("Gruyère")).toBe("gruyère");
  });

  it("still drops punctuation, which was the rule's actual job", () => {
    expect(normaliseName("trader joe's orange chicken")).toBe("trader joe s orange chicken");
    expect(normaliseName("grey goose® vodka")).toBe("grey goose vodka");
  });

  it("still lowercases, strips parentheses and cuts at a comma", () => {
    expect(normaliseName("Onions (red), finely chopped")).toBe("onions");
  });
});

/*
 * Folding is a SEPARATE function, and deliberately so.
 *
 * `normaliseName` feeds display and bucket keys, where `jalapeño` is the right answer. An
 * external catalogue search wants `jalapeno`, because that is how a shelf spells it. One function
 * cannot do both — the same argument that keeps the allergen matcher out of the catalog matcher
 * (§71): there the head noun was needed by one and discarded by the other, and here the accent is.
 */
describe("folding for an external search", () => {
  it("folds accents to their base letter", () => {
    expect(foldForSearch("jalapeño")).toBe("jalapeno");
    expect(foldForSearch("crème fraîche")).toBe("creme fraiche");
    expect(foldForSearch("Gruyère")).toBe("gruyere");
  });

  it("folds Swedish vowels the way a catalogue would spell them", () => {
    expect(foldForSearch("rödkål")).toBe("rodkal");
    expect(foldForSearch("äppelmust")).toBe("appelmust");
  });

  it("leaves a plain name alone, so it is safe to apply unconditionally", () => {
    expect(foldForSearch("whole kernel corn")).toBe("whole kernel corn");
  });
});
