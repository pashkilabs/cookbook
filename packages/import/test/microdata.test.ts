import { describe, expect, it } from "vitest";
import { extractCanonicalUrl, extractSiteName } from "../src/microdata.js";
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

describe("the address a page says it lives at", () => {
  const PAGE = "https://pipingpotcurry.com/instant-pot-carrot-soup/";

  it("reads the canonical link, whatever order the attributes come in", () => {
    // every spelling below is one a real page uses, and a regex is a guess about a spelling
    // until something prints the ones that exist — see the note in this project's memory
    for (const tag of [
      `<link rel="canonical" href="${PAGE}" />`,
      `<link href="${PAGE}" rel="canonical">`,
      `<link rel=canonical href="${PAGE}">`,
      `<link rel="canonical" href="${PAGE}" data-next-head/>`,
    ]) {
      expect(extractCanonicalUrl(`<head>${tag}</head>`, `${PAGE}?amp=true`), tag).toBe(PAGE);
    }
  });

  it("resolves a relative canonical against the page it was read from", () => {
    expect(
      extractCanonicalUrl(`<link rel="canonical" href="/soup/">`, `${PAGE}?amp=true`),
    ).toBe("https://pipingpotcurry.com/soup/");
  });

  it("treats www as the same host, since half the web's canonicals only differ by it", () => {
    expect(
      extractCanonicalUrl(`<link rel="canonical" href="https://www.example.com/pie">`, "https://example.com/pie/"),
    ).toBe("https://www.example.com/pie");
  });

  it("ignores a canonical pointing at a different site", () => {
    // a canonical is a claim a page makes about itself and a page can claim anything; trusting
    // one across hosts would let a scraper attribute a recipe to the site it copied, and would
    // let any page write into the shared cache under somebody else's key
    expect(
      extractCanonicalUrl(`<link rel="canonical" href="${PAGE}">`, "https://scraper.example/stolen"),
    ).toBeNull();
  });

  it("says nothing rather than guessing when there is no canonical", () => {
    expect(extractCanonicalUrl("<head><title>no canonical here</title></head>", PAGE)).toBeNull();
    expect(extractCanonicalUrl(`<link rel="canonical">`, PAGE)).toBeNull();
    expect(extractCanonicalUrl(`<link rel="canonical" href="javascript:void 0">`, PAGE)).toBeNull();
  });
});
