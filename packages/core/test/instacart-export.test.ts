import { describe, expect, it } from "vitest";
import {
  buildShoppingListRequest,
  consolidate,
  createCatalog,
  parseIngredientList,
  searchBranches,
  type ShoppingLine,
} from "../src/index.js";

/**
 * Exporting the week's list (§73).
 *
 * ---------------------------------------------------------------------------
 * The ticks join, walked rather than assumed
 * ---------------------------------------------------------------------------
 *
 * `shopping_ticks` live **outside** `consolidate`: the screen holds them and nothing in a
 * `ShoppingLine` knows an item is ticked. So an export built from `consolidate` alone re-buys the
 * whole trolley — and **both halves are correct today**, which is the shape four of this project's
 * bugs have had. Component tests cover the hops and cannot see the join by construction.
 *
 * So this walks the value: two recipes that share cream → consolidate → one line ticked → the
 * request body, asserting at the far end. Written before the exporter existed.
 */
const catalog = createCatalog([]);

const entry = (label: string, lines: string[], scale = 1) => ({
  label,
  scale,
  ingredients: parseIngredientList(lines),
});

describe("the whole path: two recipes, one tick, one request body", () => {
  const tuesday = entry("Tuesday", ["1 cup double cream", "200 g flour", "2 onions"]);
  const friday = entry("Friday", ["1 cup double cream", "4 tomatoes"]);
  const lines = consolidate([tuesday, friday], catalog, { system: "us" });

  const names = (body: { line_items: Array<{ name: string }> }) =>
    body.line_items.map((item) => item.name);

  it("consolidates the cream into ONE line item, which is the point of the export", () => {
    const body = buildShoppingListRequest(lines, { title: "This week", ticked: new Set() });
    expect(names(body).filter((name) => /cream/.test(name))).toHaveLength(1);
  });

  // regression: the join. `consolidate` cannot know about a tick, so an exporter that forgets to
  // ask would send a trolley a household has already filled.
  it("omits a ticked item entirely", () => {
    const creamKey = lines.find((line) => /cream/.test(line.label))!.key;
    const body = buildShoppingListRequest(lines, {
      title: "This week",
      ticked: new Set([creamKey]),
    });
    expect(names(body).some((name) => /cream/.test(name))).toBe(false);
    // and the rest survives: a tick removes one line, not the list
    expect(names(body).length).toBe(lines.length - 1);
  });

  it("reports what it withheld, so the absence is stated rather than silent", () => {
    const creamKey = lines.find((line) => /cream/.test(line.label))!.key;
    const body = buildShoppingListRequest(lines, {
      title: "This week",
      ticked: new Set([creamKey]),
    });
    expect(body.withheld.map((w) => w.reason)).toContain("ticked");
    expect(body.withheld.some((w) => /cream/.test(w.label))).toBe(true);
  });

  it("sends nothing at all when every line is ticked, rather than an empty list", () => {
    const body = buildShoppingListRequest(lines, {
      title: "This week",
      ticked: new Set(lines.map((line) => line.key)),
    });
    expect(body.line_items).toHaveLength(0);
    // the caller must refuse to POST this: their API requires line_items, and a page offering
    // nothing is worse than no page
    expect(body.sendable).toBe(false);
  });
});

describe("what the pantry means to an export", () => {
  const line = (over: Partial<ShoppingLine>): ShoppingLine => ({
    key: "rice", label: "rice", aisle: "Dry Goods", dimension: "weight",
    needed: 500, neededDisplay: "500 g", packages: null, packagesDisplay: null,
    capacity: 0, leftover: 0, leftoverDisplay: null, uses: [],
    inPantry: false, pantryDeducted: false, otherDimensions: [], ...over,
  });

  it("drops a line fully covered by the pantry rather than sending a zero", () => {
    const body = buildShoppingListRequest(
      [line({ needed: 0, inPantry: true, pantryDeducted: true })],
      { title: "x", ticked: new Set() },
    );
    expect(body.line_items).toHaveLength(0);
    expect(body.withheld[0]?.reason).toBe("already have it");
  });

  it("sends the shortfall when the pantry amount was actually subtracted", () => {
    const body = buildShoppingListRequest(
      [line({ needed: 300, inPantry: true, pantryDeducted: true })],
      { title: "x", ticked: new Set() },
    );
    expect(body.line_items).toHaveLength(1);
  });

  /*
   * The case `inPantry` alone cannot express. "We have some rice", no amount — so nothing was
   * subtracted and `needed` is the full requirement. Buying it re-buys; not buying it may leave a
   * household short. Withheld and NAMED is the only honest answer, and it is the same shape the
   * allergen filter uses for what it hid.
   */
  it("withholds an item the household has in an unknown amount, and names it", () => {
    const body = buildShoppingListRequest(
      [line({ needed: 500, inPantry: true, pantryDeducted: false })],
      { title: "x", ticked: new Set() },
    );
    expect(body.line_items).toHaveLength(0);
    expect(body.withheld[0]).toMatchObject({ label: "rice", reason: "already have some" });
  });
});

/*
 * `or` is a choice the recipe made, not debris (§75).
 *
 * 23% of a real week's names found nothing in Kroger's catalogue, and roughly a third of those
 * were alternatives: `honey or agave syrup`, `english or hothouse cucumber`. No single search can
 * match them, because no product is both.
 */
describe("a name offering a choice", () => {
  it("splits into the things it offers", () => {
    expect(searchBranches("honey or agave syrup")).toEqual(["honey", "agave syrup"]);
    expect(searchBranches("english or hothouse cucumber")).toEqual(["english", "hothouse cucumber"]);
  });

  it("puts the recipe's own first choice first, because the order is its preference", () => {
    // a cook writing "honey or agave syrup" wants honey and will accept agave; reversing that
    // loses information the recipe gave freely
    expect(searchBranches("honey or agave syrup")[0]).toBe("honey");
  });

  it("drops a branch that only qualifies, because it names nothing to search for", () => {
    expect(searchBranches("avocado oil or other neutral oil with a high smoke point"))
      .toEqual(["avocado oil"]);
  });

  it("leaves a name alone when the 'or' is part of it", () => {
    for (const name of ["cream of tartar", "rack of lamb", "orange juice", "oregano"]) {
      expect(searchBranches(name), name).toEqual([name]);
    }
  });

  it("returns one branch for a plain name, so a caller needs no special case", () => {
    expect(searchBranches("double cream")).toEqual(["double cream"]);
  });

  it("never returns nothing, even for a name that is only qualifiers", () => {
    expect(searchBranches("other neutral oil")).toEqual(["other neutral oil"]);
  });
});
