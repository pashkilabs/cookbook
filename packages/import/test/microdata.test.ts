import { describe, expect, it } from "vitest";
import { extractSiteName } from "../src/microdata.js";
describe("the site name on a recipe card", () => {
  const siteNamed = (content: string) =>
    extractSiteName(`<meta property="og:site_name" content="${content}">`);

  it("decodes the entities a publisher writes into its own name", () => {
    /*
     * regression: five of thirty-nine stored source names read `Salt &amp; Lavender` and
     * `Kroll&#039;s Korner`, printed verbatim under the photograph on every card. Titles,
     * ingredients and steps were clean because they already went through `stripTags`; the site
     * name was the one string that did not, and it is the one a person reads first.
     */
    expect(siteNamed("Salt &amp; Lavender")).toBe("Salt & Lavender");
    expect(siteNamed("Kroll&#039;s Korner")).toBe("Kroll's Korner");
    expect(siteNamed("Grey Goose&reg; Vodka")).toBe("Grey Goose Vodka");
  });

  it("leaves a plain name alone", () => {
    expect(siteNamed("Bon Appétit")).toBe("Bon Appétit");
  });

  it("is null when there is nothing to read, rather than an empty string", () => {
    expect(extractSiteName("<html></html>")).toBeNull();
    expect(siteNamed("&nbsp;")).toBeNull();
  });
});
