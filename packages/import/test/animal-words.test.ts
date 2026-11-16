import { describe, expect, it } from "vitest";
import { animalsNamed } from "../src/animal-words.js";

/**
 * The tripwire's word matching, and specifically the cases that would make it cry wolf.
 *
 * A tripwire nobody trusts gets switched off, so a false positive is more expensive here than a
 * miss. Every assertion below is either a trap this would fall into naively, or a real case it
 * has to keep catching despite the traps.
 */
describe("which animals a recipe names", () => {
  it("names the animal in a title that says it outright", () => {
    expect(animalsNamed("Korean Ground Beef Bowls")).toEqual(["beef"]);
  });

  it("does not count a broth as the dish — beef broth in a chicken soup is seasoning", () => {
    // the exact shape in production: a chicken soup whose depth comes from beef stock
    expect(animalsNamed("Hearty Soup\n2 cups beef broth\n1 lb chicken thighs")).toEqual(["chicken"]);
  });

  it("does not count duck sauce as duck, or fish sauce as fish", () => {
    expect(animalsNamed("Crispy Spring Rolls\n3 tbsp duck sauce")).toEqual([]);
    expect(animalsNamed("Pad Thai\n2 tbsp fish sauce\n1 tbsp oyster sauce")).toEqual([]);
  });

  it("does not count goat cheese as goat", () => {
    // goat cheese is on a hundred salads and in no goat curry
    expect(animalsNamed("Beetroot Salad\n100 g goat cheese\n2 tbsp olive oil")).toEqual([]);
  });

  it("reads a real recipe past its own seasonings — Homemade Spaghettios", () => {
    /*
     * The case that proves the rule rather than illustrating it. This names beef three ways:
     * `beef broth` (seasoning), `chicken bouillon cube` (seasoning, a *different* animal) and
     * `0.75 lb ground beef` (the dish). Without discounting flavourings it reads as two animals
     * and the tripwire says nothing; with it, beef alone.
     */
    const text = [
      "Homemade Spaghettios (One Pot!)",
      "2.75 cup beef broth",
      "0.5 chicken bouillon cube",
      "0.75 lb ground beef",
      "8 oz tomato sauce",
    ].join("\n");
    expect(animalsNamed(text)).toEqual(["beef"]);
  });

  it("is not fooled by an animal inside another word", () => {
    // `ham` in hamburger, `sole` in casserole, `veal` in reveal — every pattern is anchored
    expect(animalsNamed("Homemade Hamburger Helper")).toEqual(["beef"]);
    expect(animalsNamed("Green Bean Casserole\n2 cans green beans")).toEqual([]);
    expect(animalsNamed("A recipe to reveal at Christmas\n200 g flour")).toEqual([]);
  });

  it("says nothing when two animals are named, because that is a judgement", () => {
    expect(animalsNamed("The BEST Meatball Recipe\n1 lb ground beef\n1 lb ground pork").sort())
      .toEqual(["beef", "pork"]);
  });

  it("says nothing about a dish with no animal in it", () => {
    expect(animalsNamed("Fresh Basil Pesto\n2 cups basil\n0.5 cup pine nuts")).toEqual([]);
  });

  it("does not look for egg at all, and that is a stated cost", () => {
    /*
     * regression-shaped: `egg` is in the enum and in most baked goods as a binder, so including
     * it would flag every cake. The price is real and is paid knowingly — `Easy Fried Rice` is
     * correctly `egg` in production and this will never find it.
     */
    expect(animalsNamed("Victoria Sponge\n4 eggs\n200 g flour\n200 g butter")).toEqual([]);
    expect(animalsNamed("Easy Fried Rice\n3 cup cooked rice\n2 lightly beaten eggs")).toEqual([]);
  });

  it("reads bacon and salami as pork, which is how a recipe says pork without saying pork", () => {
    expect(animalsNamed("loaded potato soup\n1 lb chopped cooked bacon\n3 lb potatos")).toEqual(["pork"]);
    expect(animalsNamed("Italian Chopped Salad\n0.33 lb sliced salami\n0.33 lb sliced pepperoni")).toEqual(["pork"]);
  });
});
