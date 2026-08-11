import { describe, expect, it } from "vitest";
import { createCatalog, choosePackages } from "../src/catalog.js";
import { SEED_CATALOG } from "../src/seed-catalog.js";
import { parseIngredientList } from "../src/parse.js";
import { consolidate, recipesUsingLeftovers, significantLeftovers } from "../src/consolidate.js";
import type { ConsolidationEntry } from "../src/types.js";

const catalog = createCatalog(SEED_CATALOG);

const recipe = (label: string, lines: string[], scale?: number): ConsolidationEntry => ({
  label,
  ingredients: parseIngredientList(lines),
  ...(scale !== undefined ? { scale } : {}),
});

const lineFor = (lines: ReturnType<typeof consolidate>, key: string) => {
  const found = lines.find((l) => l.key === key);
  if (!found) throw new Error(`no line for ${key} (got ${lines.map((l) => l.key).join(", ")})`);
  return found;
};

describe("catalog matching", () => {
  it("finds items through preparation words", () => {
    expect(catalog.find("finely chopped onion")?.key).toBe("onion");
    expect(catalog.find("boneless skinless chicken breasts")?.key).toBe("chicken-breast");
    expect(catalog.find("freshly grated parmesan cheese")?.key).toBe("parmesan");
  });

  it("keeps tinned tomatoes apart from fresh ones", () => {
    // regression: stripping "diced" merged a tin into the produce aisle
    expect(catalog.find("diced tomatoes")?.key).toBe("canned-tomatoes");
    expect(catalog.find("tomatoes")?.key).toBe("tomatoes");
    expect(catalog.find("cherry tomatoes")?.key).toBe("tomatoes");
  });

  it("prefers the longest matching name", () => {
    expect(catalog.find("buttermilk")?.key).toBe("buttermilk");
    expect(catalog.find("sun dried tomatoes")?.key).toBe("sun-dried-tomatoes");
    expect(catalog.find("heavy whipping cream")?.key).toBe("heavy-cream");
  });

  it("falls back to keywords for items it does not carry", () => {
    expect(catalog.find("smoked paprika")).toBeNull();
    expect(catalog.aisleFor("smoked paprika")).toBe("Spices");
    expect(catalog.aisleFor("courgette")).toBe("Produce");
    expect(catalog.aisleFor("something unheard of")).toBe("Other");
  });
});

describe("choosePackages", () => {
  it("picks the smallest package that covers the need", () => {
    const cream = catalog.find("heavy cream")!;
    const picked = choosePackages(355, cream.packages);
    expect(picked).toEqual([{ size: { label: "pint (16 oz)", amount: 473 }, count: 1 }]);
  });

  it("buys loose produce individually instead of forcing a multipack", () => {
    // regression: asking for 3 tomatoes suggested a pint container of 12
    const tomatoes = catalog.find("tomatoes")!;
    expect(choosePackages(3, tomatoes.packages)).toEqual([
      { size: { label: "loose", amount: 1 }, count: 3 },
    ]);
  });

  it("moves to the multipack once it is worth it", () => {
    const lemon = catalog.find("lemon")!;
    expect(choosePackages(5, lemon.packages)[0]!.size.label).toBe("bag of 5");
  });

  it("multiplies up when the need exceeds the largest size", () => {
    const cream = catalog.find("heavy cream")!;
    const picked = choosePackages(2000, cream.packages);
    const total = picked.reduce((sum, p) => sum + p.size.amount * p.count, 0);
    expect(total).toBeGreaterThanOrEqual(2000);
  });

  it("returns nothing when nothing is needed", () => {
    expect(choosePackages(0, catalog.find("lemon")!.packages)).toEqual([]);
  });
});

describe("consolidate", () => {
  it("merges an ingredient across recipes and picks one package", () => {
    const lines = consolidate(
      [
        recipe("Tuscan Chicken", ["1 cup heavy cream", "3 cloves garlic"]),
        recipe("Vodka Rigatoni", ["1/2 cup heavy cream", "4 cloves garlic"]),
      ],
      catalog,
    );

    const cream = lineFor(lines, "heavy-cream");
    expect(cream.neededDisplay).toBe("1½ cup");
    expect(cream.packagesDisplay).toBe("pint (16 oz)");
    expect(cream.leftoverDisplay).toBe("½ cup");
    expect(cream.uses).toHaveLength(2);
    expect(cream.uses.map((u) => u.label)).toEqual(["Tuscan Chicken", "Vodka Rigatoni"]);
  });

  it("reports how the package divides, for the split display", () => {
    const lines = consolidate(
      [
        recipe("Monday", ["1 cup heavy cream"], 1),
        recipe("Friday", ["1/2 cup heavy cream"], 1),
      ],
      catalog,
    );
    const cream = lineFor(lines, "heavy-cream");
    const share = cream.uses.map((u) => Math.round((u.amount / cream.capacity) * 100));
    expect(share).toEqual([50, 25]); // and 25% spare
    expect(cream.uses[0]!.display).toBe("1 cup");
  });

  it("converts cloves into heads of garlic", () => {
    const lines = consolidate([recipe("A", ["3 cloves garlic"]), recipe("B", ["4 cloves garlic"])], catalog);
    const garlic = lineFor(lines, "garlic");
    expect(garlic.neededDisplay).toBe("7 cloves");
    expect(garlic.packagesDisplay).toBe("1 head (~10 cloves)");
    expect(garlic.leftoverDisplay).toBe("3 cloves");
  });

  it("applies the batch scale", () => {
    const single = consolidate([recipe("A", ["1 lb ground beef"])], catalog);
    const double = consolidate([recipe("A", ["1 lb ground beef"], 2)], catalog);
    expect(lineFor(single, "ground-beef").needed).toBeCloseTo(453.6, 0);
    expect(lineFor(double, "ground-beef").needed).toBeCloseTo(907.2, 0);
  });

  it("drops cupboard staples", () => {
    const lines = consolidate([recipe("A", ["1 tsp salt", "1 cup heavy cream", "water"])], catalog);
    expect(lines.map((l) => l.key)).toEqual(["heavy-cream"]);
  });

  it("keeps staples when asked to", () => {
    const lines = consolidate([recipe("A", ["1 tsp salt"])], catalog, { excludeStaples: false });
    expect(lines).toHaveLength(1);
  });

  it("orders by supermarket aisle", () => {
    const lines = consolidate(
      [recipe("A", ["1 cup heavy cream", "1 onion", "1 lb chicken breast", "1 lb pasta"])],
      catalog,
    );
    expect(lines.map((l) => l.aisle)).toEqual(["Produce", "Meat & Seafood", "Dairy", "Pantry"]);
  });

  it("flags what is already in the pantry", () => {
    const lines = consolidate([recipe("A", ["1 cup heavy cream"])], catalog, {
      pantry: [{ name: "heavy cream" }],
    });
    expect(lineFor(lines, "heavy-cream").inPantry).toBe(true);
  });

  it("subtracts a known pantry quantity when asked", () => {
    const lines = consolidate([recipe("A", ["2 cups heavy cream"])], catalog, {
      pantry: [{ name: "heavy cream", amount: 1, unit: "cup" }],
      deductPantry: true,
    });
    expect(lineFor(lines, "heavy-cream").neededDisplay).toBe("1 cup");
  });

  it("never reports zero for a tin whose size is unknown", () => {
    // regression: a bare "1 can" against a weight-sold item displayed "0 g"
    const lines = consolidate([recipe("A", ["1 can black beans"])], catalog);
    const beans = lineFor(lines, "beans");
    expect(beans.needed).toBeGreaterThan(0);
    expect(beans.neededDisplay).not.toMatch(/^0/);
  });

  it("keeps measures that cannot merge in a separate bucket", () => {
    const lines = consolidate([recipe("A", ["1 bunch cilantro", "2 tbsp cilantro"])], catalog);
    const cilantro = lineFor(lines, "cilantro");
    expect(cilantro.dimension).toBe("bunch");
    expect(cilantro.otherDimensions.length).toBeGreaterThan(0);
  });

  it("passes uncatalogued items through without package maths", () => {
    const lines = consolidate([recipe("A", ["2 tbsp smoked paprika"])], catalog);
    const paprika = lines[0]!;
    expect(paprika.packages).toBeNull();
    expect(paprika.aisle).toBe("Spices");
    expect(paprika.neededDisplay).toBe("2 tbsp");
  });

  it("handles an empty week", () => {
    expect(consolidate([], catalog)).toEqual([]);
  });
});

describe("leftovers", () => {
  it("ignores trivial remainders", () => {
    const lines = consolidate([recipe("A", ["1 lb chicken breast"])], catalog);
    expect(significantLeftovers(lines)).toHaveLength(0);
  });

  it("surfaces a leftover worth planning around", () => {
    // half a cup against the smallest carton leaves half a cup spare
    const lines = consolidate([recipe("A", ["1/2 cup heavy cream"])], catalog);
    const spare = significantLeftovers(lines);
    expect(spare.map((l) => l.key)).toContain("heavy-cream");
  });

  it("suggests recipes that would finish the leftover", () => {
    const planned = consolidate([recipe("Tuscan Chicken", ["1/2 cup heavy cream"])], catalog);
    const spare = significantLeftovers(planned);
    const library = [
      { title: "Vodka Rigatoni", ingredients: parseIngredientList(["1/2 cup heavy cream"]) },
      { title: "Chicken Fajitas", ingredients: parseIngredientList(["3 bell peppers"]) },
    ];
    const ideas = recipesUsingLeftovers(spare, library, catalog);
    expect(ideas.map((r) => r.title)).toEqual(["Vodka Rigatoni"]);
  });
});

describe("end to end, a real week", () => {
  it("produces a consolidated list from four recipes", () => {
    const lines = consolidate(
      [
        recipe("Creamy Tuscan Chicken", [
          "1.5 lb chicken breast", "1 cup heavy cream", "1/2 cup grated parmesan",
          "3 cloves garlic", "5 oz baby spinach", "2 tbsp olive oil", "salt and pepper to taste",
        ]),
        recipe("Tomato Vodka Rigatoni", [
          "1 lb rigatoni", "1/2 cup heavy cream", "1 (6 oz) can tomato paste",
          "4 cloves garlic", "1 large onion", "1/2 cup grated parmesan",
        ]),
        recipe("Sheet-Pan Fajitas", [
          "1.5 lb chicken breast", "3 bell peppers", "1 onion", "8 flour tortillas", "Juice of 1 lime",
        ]),
        recipe("Honey Garlic Salmon", [
          "1.5 lb salmon", "3 tbsp honey", "4 cloves garlic", "2 tbsp soy sauce", "1 cup jasmine rice",
        ]),
      ],
      catalog,
    );

    expect(lineFor(lines, "heavy-cream").packagesDisplay).toBe("pint (16 oz)");
    expect(lineFor(lines, "garlic").neededDisplay).toBe("11 cloves");
    expect(lineFor(lines, "garlic").packagesDisplay).toBe("3-pack heads");
    expect(lineFor(lines, "chicken-breast").neededDisplay).toBe("3 lb");
    const onion = lineFor(lines, "onion");
    expect(onion.packagesDisplay).toBeNull();   // loose: caller shows "2 onion"
    expect(onion.neededDisplay).toBe("2");
    expect(lines.every((l) => l.key !== "salt")).toBe(true);

    const parmesan = lineFor(lines, "parmesan");
    expect(parmesan.uses).toHaveLength(2);
    expect(parmesan.packages).not.toBeNull();
  });
});
