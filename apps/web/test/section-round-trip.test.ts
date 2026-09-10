import { describe, expect, it } from "vitest";
import { parseIngredientList } from "@pashki/core";
import { draftFrom, ingredientsAsText } from "../lib/draft";
import { prepareRecipe } from "../lib/recipe-input";

/**
 * The journey, in order, across the boundary — not the components beside it.
 *
 * Each hop was already right on its own: the parser reads a heading, `draftFrom` writes it back
 * as a "Sauce:" line, `prepareRecipe` re-parses it, `writeChildren` inserts `section`. Nothing
 * tested the *handoff*, and a component test cannot see one. Production carries zero sectioned
 * rows, which proves nothing either way — neither real import since the column landed had a
 * heading in its source — so the only way to know is to walk the path.
 */
const extracted = {
  title: "Brownies",
  servings: 9,
  totalMinutes: 45,
  sourceName: "Somewhere",
  sourceUrl: "https://example.com/brownies",
  ingredients: parseIngredientList([
    "Brownie Layer:",
    "200 g dark chocolate",
    "2 eggs",
    "For the frosting:",
    "100 g butter",
    "2 cups icing sugar",
  ]),
  steps: ["Melt the chocolate.", "Beat in the eggs."],
  course: "dessert",
  cuisine: null,
} as unknown as Parameters<typeof draftFrom>[0];

describe("a recipe imported with headings keeps them all the way to the insert", () => {
  it("parses headings as sections rather than as ingredients", () => {
    expect(extracted.ingredients.map((line) => line.item)).toEqual([
      "dark chocolate",
      "eggs",
      "butter",
      "icing sugar",
    ]);
    expect(extracted.ingredients.map((line) => line.section)).toEqual([
      "Brownie Layer",
      "Brownie Layer",
      "For the frosting",
      "For the frosting",
    ]);
  });

  it("writes the headings back into the review screen's text", () => {
    const draft = draftFrom(extracted);
    // the review screen shows text and re-parses it on save: anything not in the text is lost
    expect(draft.ingredients.split("\n")).toEqual([
      "Brownie Layer:",
      "200 g dark chocolate",
      "2 eggs",
      "For the frosting:",
      "100 g butter",
      "2 cups icing sugar",
    ]);
  });

  it("survives the round trip to what the insert actually writes", () => {
    const draft = draftFrom(extracted);
    const prepared = prepareRecipe({
      title: draft.title,
      servings: draft.servings,
      timeMinutes: draft.timeMinutes,
      sourceName: draft.sourceName,
      ingredients: draft.ingredients,
      steps: draft.steps,
      course: draft.course,
      cuisine: draft.cuisine,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.recipe.ingredients.map((line) => [line.itemText, line.section])).toEqual([
      ["dark chocolate", "Brownie Layer"],
      ["eggs", "Brownie Layer"],
      ["butter", "For the frosting"],
      ["icing sugar", "For the frosting"],
    ]);
  });

  it("does not invent a section for a recipe that declared none", () => {
    const plain = { ...extracted, ingredients: parseIngredientList(["2 eggs", "100 g butter"]) };
    const draft = draftFrom(plain as typeof extracted);
    expect(draft.ingredients.split("\n")).toEqual(["2 eggs", "100 g butter"]);
    const prepared = prepareRecipe({
      title: draft.title, servings: draft.servings, timeMinutes: draft.timeMinutes,
      sourceName: draft.sourceName, ingredients: draft.ingredients, steps: draft.steps,
      course: draft.course, cuisine: draft.cuisine,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.recipe.ingredients.every((line) => line.section === null)).toBe(true);
  });
});

/**
 * The second door.
 *
 * regression: the walk above proved the IMPORT path and I called `section` safe on it. The edit
 * screen was a second door to the same insert — it rebuilt the textarea inline, emitted no
 * heading lines, and the save re-parses that textarea, so opening any recipe in the editor and
 * saving erased every heading it declared. A route with two doors needs both tested; so does a
 * value with two writers.
 */
describe("editing a recipe does not erase the headings it declared", () => {
  // the rows as the edit screen reads them back out of the database
  const stored = [
    { amount: 200, unit: "g", item: "dark chocolate", note: null, section: "Brownie Layer" },
    { amount: 2, unit: null, item: "eggs", note: null, section: "Brownie Layer" },
    { amount: 100, unit: "g", item: "butter", note: null, section: "For the frosting" },
  ];

  it("puts the headings back into the textarea the editor shows", () => {
    expect(ingredientsAsText(stored).split("\n")).toEqual([
      "Brownie Layer:",
      "200 g dark chocolate",
      "2 eggs",
      "For the frosting:",
      "100 g butter",
    ]);
  });

  it("survives an edit that changes nothing", () => {
    const prepared = prepareRecipe({
      title: "Brownies",
      servings: "9",
      timeMinutes: "45",
      sourceName: "",
      ingredients: ingredientsAsText(stored),
      steps: "Melt the chocolate.",
      course: "dessert",
      cuisine: "",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.recipe.ingredients.map((line) => [line.itemText, line.section])).toEqual([
      ["dark chocolate", "Brownie Layer"],
      ["eggs", "Brownie Layer"],
      ["butter", "For the frosting"],
    ]);
  });

  it("renders both doors identically, because they are one function now", () => {
    const viaImport = draftFrom(extracted).ingredients;
    const viaEdit = ingredientsAsText(
      extracted.ingredients.map((line) => ({
        amount: line.amount, unit: line.unit, item: line.item,
        note: line.note, section: line.section ?? null,
      })),
    );
    expect(viaEdit).toBe(viaImport);
  });
});
