import { describe, expect, it } from "vitest";
import { PRINCIPAL_PROTEINS } from "@pashki/core";
import {
  AT_A_TIME,
  MAINS_BY_PROTEIN,
  TOP_LEVEL,
  chapterBySlug,
  chapterHref,
  counted,
  iconUrl,
  subdivision,
  type Classified,
} from "../lib/chapters";

const r = (course: string | null, dish_form: string | null = null, principal_protein: string | null = null): Classified => ({
  course,
  dish_form,
  principal_protein,
});

/**
 * The real library, as measured against hosted on 2026-10-20 — not the wireframe's figures.
 *
 * Every count in the drawing was illustrative and three were wrong by more than rounding, so this
 * fixture is built from `course`/`dish_form`/`principal_protein` as they actually are. It is the
 * only honest way to test "does the nine-tile grid hold", because the answer turns on the data.
 */
const LIBRARY: Classified[] = [
  // 32 mains: pork 10, chicken 8, beef 2, fish 1, seafood 1, unassigned 10
  ...Array.from({ length: 10 }, () => r("main", null, "pork")),
  ...Array.from({ length: 8 }, () => r("main", null, "chicken")),
  ...Array.from({ length: 2 }, () => r("main", null, "beef")),
  r("main", null, "fish"),
  r("main", null, "seafood"),
  // four of the mains are also soups, one is also a salad — the deliberate overlap
  ...Array.from({ length: 4 }, () => r("main", "soup", null)),
  r("main", "salad", null),
  ...Array.from({ length: 5 }, () => r("main", null, null)),
  // the fifth soup is not a main
  r(null, "soup", null),
  ...Array.from({ length: 5 }, () => r("side")),
  ...Array.from({ length: 4 }, () => r("dessert")),
  r("starter"),
  r("breakfast"),
  r("drink"),
  ...Array.from({ length: 22 }, () => r(null)),
];

describe("the measured library, against which the wireframe's figures were illustrative", () => {
  it("is 67 recipes", () => {
    expect(LIBRARY).toHaveLength(67);
  });

  it("counts the chapters as hosted does", () => {
    const got = Object.fromEntries(counted(LIBRARY).map(({ chapter, count }) => [chapter.slug, count]));
    expect(got).toEqual({
      main: 32,
      soup: 5,
      salad: 1,
      side: 5,
      starter: 1,
      dessert: 4,
      breakfast: 1,
      drink: 1,
      unsorted: 23,
    });
  });

  it("drops Snacks, which holds nothing — so it is eight tiles and a row, not nine tiles", () => {
    const slugs = counted(LIBRARY).map(({ chapter }) => chapter.slug);
    expect(slugs).not.toContain("snack");
    // the wireframe drew nine tiles plus the unsorted row; the data gives eight plus the row
    expect(slugs.filter((slug) => slug !== "unsorted")).toHaveLength(8);
  });

  it("does not make the counts sum to the library, because a soup is a soup and a main", () => {
    const sum = counted(LIBRARY).reduce((total, { count }) => total + count, 0);
    // 73 over 67: five soups and one salad are counted twice, by design (§84)
    expect(sum).toBe(73);
    expect(sum).toBeGreaterThan(LIBRARY.length);
  });

  it("counts Mains by protein as hosted does, and omits the three empty groups", () => {
    const mains = LIBRARY.filter((recipe) => recipe.course === "main");
    const got = Object.fromEntries(
      counted(mains, MAINS_BY_PROTEIN).map(({ chapter, count }) => [chapter.slug, count]),
    );
    expect(got).toEqual({ pork: 10, chicken: 8, beef: 2, fish: 1, seafood: 1, unassigned: 10 });
    // the brief predicted Eggs would be 0; Lamb and Meat-free are too, and the drawing showed 1 each
    for (const slug of ["lamb", "egg", "vegetarian"]) expect(got).not.toHaveProperty(slug);
  });

  it("names the 10 unclassified mains rather than hiding them", () => {
    const mains = LIBRARY.filter((recipe) => recipe.course === "main");
    const everythingElse = counted(mains, MAINS_BY_PROTEIN).find(({ chapter }) => chapter.slug === "unassigned");
    expect(everythingElse?.count).toBe(10);
    expect(everythingElse?.chapter.label).toBe("Everything else");
  });

  it("covers every main: the protein groups sum to Mains exactly", () => {
    const mains = LIBRARY.filter((recipe) => recipe.course === "main");
    const sum = counted(mains, MAINS_BY_PROTEIN).reduce((total, { count }) => total + count, 0);
    // unlike the chapters, these partition — a main has one principal protein or none
    expect(sum).toBe(mains.length);
  });
});

describe("the subdivision rule: an axis must exist AND the chapter must exceed seven", () => {
  it("divides Mains, which has an axis and 32 recipes", () => {
    expect(subdivision(chapterBySlug("main")!, 32)).toBe(MAINS_BY_PROTEIN);
  });

  it("does not divide Mains when it is under the cap", () => {
    expect(subdivision(chapterBySlug("main")!, AT_A_TIME)).toBeNull();
  });

  it("does not divide Soups, even at nine — dish_form put it in the chapter, so it cannot also cut it", () => {
    expect(subdivision(chapterBySlug("soup")!, 9)).toBeNull();
  });

  it("does not divide Not-sorted, which has no axis by definition", () => {
    expect(subdivision(chapterBySlug("unsorted")!, 23)).toBeNull();
  });
});

describe("the two columns the chapters are cut on", () => {
  it("takes Soups and Salads from dish_form, so a soup that is also a main is in both", () => {
    const soupMain = [r("main", "soup")];
    const slugs = counted(soupMain).map(({ chapter }) => chapter.slug);
    expect(slugs).toEqual(["main", "soup"]);
  });

  it("gives every course the database permits a chapter, including null", () => {
    for (const course of ["breakfast", "starter", "main", "side", "dessert", "drink", "snack", null]) {
      const found = TOP_LEVEL.filter((chapter) => chapter.holds(r(course)));
      expect(found.length, `course ${String(course)} has no chapter`).toBe(1);
    }
  });

  it("puts vegan under Meat-free rather than leaving it out", () => {
    expect(counted([r("main", null, "vegan")], MAINS_BY_PROTEIN)[0]!.chapter.slug).toBe("vegetarian");
  });
});

describe("the icons", () => {
  it("names a file for every chapter except the one that is an absence", () => {
    for (const chapter of [...TOP_LEVEL, ...MAINS_BY_PROTEIN]) {
      if (chapter.slug === "unassigned") expect(chapter.icon).toBe("");
      else expect(chapter.icon, `${chapter.slug} has no icon`).toMatch(/\.png$/);
    }
  });

  it("builds a url() a mask can take, never an <img> src", () => {
    expect(iconUrl("soup.png")).toBe("url(/chapters/soup.png)");
  });

  it("gives each chapter its own drawing, so two chapters never read as one", () => {
    const icons = TOP_LEVEL.map((chapter) => chapter.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("the routes", () => {
  it("links a chapter and a protein under it", () => {
    expect(chapterHref("soup")).toBe("/recipes/c/soup");
    expect(chapterHref("pork", "main")).toBe("/recipes/c/main/pork");
  });

  it("returns null for an unknown slug rather than falling back to Mains", () => {
    // a wrong chapter that renders is worse than one that admits it is not there
    expect(chapterBySlug("nonsense")).toBeNull();
    expect(chapterBySlug("main", MAINS_BY_PROTEIN)).toBeNull();
  });

  it("gives every chapter a slug that survives a URL unchanged", () => {
    for (const chapter of [...TOP_LEVEL, ...MAINS_BY_PROTEIN]) {
      expect(encodeURIComponent(chapter.slug)).toBe(chapter.slug);
    }
  });
});

/**
 * A value the column can hold and no chapter holds is in the database and on no screen.
 *
 * This is the half of widening an enum that nothing else checks. `turkey` reached the column and
 * the model's schema in one change; had `MAINS_BY_PROTEIN` been left alone, a turkey recipe would
 * have counted towards Mains, matched none of its subdivisions, and appeared nowhere — not even in
 * "Everything else", whose `holds` is `principal_protein === null`. Silent, and worse than the
 * misclassification it was fixing, because a wrong chapter is at least a chapter.
 *
 * Asserted through `holds` rather than against the slugs, because `vegan` deliberately has no
 * chapter of its own: Meat-free holds both. What matters is that every value is held by
 * *something*, which is what decides whether a recipe can be seen.
 */
describe("every protein the column can hold has somewhere to appear", () => {
  it.each([...PRINCIPAL_PROTEINS])("a main whose protein is %s lands in a chapter", (protein) => {
    const recipe = r("main", null, protein);
    const holders = MAINS_BY_PROTEIN.filter((chapter) => chapter.holds(recipe));
    expect(holders.map((chapter) => chapter.slug)).toHaveLength(1);
  });

  /*
   * **This assertion reversed when the artwork arrived, and the old one read as the stronger of
   * the two.** It used to require `meat-platter.png` on both tiles — correct while no turkey or
   * duck had been drawn, and it would have defended the borrowed platter against the real icons.
   * It points at a design decision, not a rule, so: if the drawings are ever withdrawn this flips
   * back, and nothing else in the suite would say so.
   *
   * What survives either way is the part that was never about the platter: no tile may wear the
   * chicken's face but Chicken.
   */
  it("gives every bird its own drawing rather than lending the chicken's face", () => {
    const icons = ["turkey", "duck"].map(
      (slug) => MAINS_BY_PROTEIN.find((chapter) => chapter.slug === slug)?.icon,
    );
    expect(icons).toEqual(["turkey.png", "duck.png"]);
    expect(icons).not.toContain("chicken.png");
    expect(icons).not.toContain("poultry.png");
  });

  it("names a file for every protein, since a chapter appears the moment a household has one", () => {
    // a mask pointing at a missing file paints nothing in both themes with no error anywhere;
    // check-chapter-icons.mjs asserts the file exists, this asserts one was named at all
    const withoutIcon = MAINS_BY_PROTEIN.filter((chapter) => chapter.slug !== "unassigned")
      .filter((chapter) => !chapter.icon);
    expect(withoutIcon.map((chapter) => chapter.slug)).toEqual([]);
  });
});
