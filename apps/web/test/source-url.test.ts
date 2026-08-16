import { describe, expect, it } from "vitest";
import { sourceUrlIn } from "../lib/import";

/**
 * A caption's own link is the only provenance a pasted recipe can have, and storing an ingredient
 * list without one is the weakest version of this feature.
 */
describe("the blog link inside a caption", () => {
  it("takes the recipe's own link past the hashtag links", () => {
    // the real peach posset caption: four hashtag links, one blog link
    const caption = [
      "A peaches and cream dream 😍",
      "https://whatmollymade.com/peach-posset/",
      "#peachrecipe #summerdessert",
    ].join("\n");
    expect(sourceUrlIn(caption)).toBe("https://whatmollymade.com/peach-posset/");
  });

  it("skips a social platform, which is the caption's own furniture", () => {
    for (const host of [
      "https://www.instagram.com/explore/tags/summerdessert/",
      "https://www.facebook.com/reel/hashtag/?q=%23padthai",
      "https://www.tiktok.com/@someone",
      "https://pin.it/abc123",
    ]) {
      expect(sourceUrlIn(`Recipe below ${host} enjoy`), host).toBe("");
    }
  });

  it("takes the first candidate, because captions put the blog link before the affiliates", () => {
    const caption = "See https://krollskorner.com/pasta/ and buy at https://amzn.to/3mijX5y";
    expect(sourceUrlIn(caption)).toBe("https://krollskorner.com/pasta/");
  });

  it("is empty when a caption links nothing, which is what the column held before", () => {
    expect(sourceUrlIn("Comment CHICKEN and I will dm you the full recipe")).toBe("");
  });

  it("drops trailing punctuation rather than storing it in the URL", () => {
    expect(sourceUrlIn("Full method at https://example.com/method.")).toBe("https://example.com/method");
  });

  it("ignores something that is not a URL at all", () => {
    expect(sourceUrlIn("Use King Arthur flour")).toBe("");
  });
});
