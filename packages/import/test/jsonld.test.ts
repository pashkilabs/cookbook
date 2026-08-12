import { describe, expect, it } from "vitest";
import {
  buildNodeIndex,
  collectJsonLd,
  durationToMinutes,
  findRecipeNode,
  flattenNodes,
  isBareReference,
  parseImageUrl,
  parseServings,
  parseSteps,
  resolveRef,
  type JsonObject,
} from "../src/index.js";

describe("collecting ld+json", () => {
  it("reads every block on the page", () => {
    const html = `
      <script type="application/ld+json">{"@type":"Organization"}</script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Pie"}</script>`;
    expect(collectJsonLd(html)).toHaveLength(2);
  });

  it("survives a malformed block, because sites ship both kinds", () => {
    const html = `
      <script type="application/ld+json">{ this is not json }</script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Pie"}</script>`;
    const found = collectJsonLd(html);
    expect(found).toHaveLength(1);
    expect(findRecipeNode(flattenNodes(found))?.name).toBe("Pie");
  });

  it("handles CDATA wrapping", () => {
    const html = `<script type="application/ld+json">//<![CDATA[
      {"@type":"Recipe","name":"Pie"}
    ]]></script>`;
    expect(collectJsonLd(html)).toHaveLength(1);
  });

  it("finds a recipe nested under a WebPage", () => {
    const html = `<script type="application/ld+json">
      {"@type":"WebPage","mainEntity":{"@type":"Recipe","name":"Nested"}}
    </script>`;
    expect(findRecipeNode(flattenNodes(collectJsonLd(html)))?.name).toBe("Nested");
  });

  it("matches @type given as an array", () => {
    const html = `<script type="application/ld+json">
      {"@type":["Article","Recipe"],"name":"Both"}
    </script>`;
    expect(findRecipeNode(flattenNodes(collectJsonLd(html)))?.name).toBe("Both");
  });
});

describe("the node index", () => {
  const bare: JsonObject = { "@id": "x", "@type": "ImageObject" };
  const real: JsonObject = { "@id": "x", "@type": "ImageObject", url: "https://cdn/pie.jpg" };

  it("recognises a node that states nothing", () => {
    expect(isBareReference(bare)).toBe(true);
    expect(isBareReference(real)).toBe(false);
  });

  it("does not let a bare reference overwrite the node it points at", () => {
    // regression: the reference arriving second replaced the real ImageObject, and
    // the image silently vanished
    expect(buildNodeIndex([real, bare]).get("x")).toEqual(real);
  });

  it("prefers the real node regardless of order", () => {
    expect(buildNodeIndex([bare, real]).get("x")).toEqual(real);
  });

  it("resolves a reference to the node it names", () => {
    const index = buildNodeIndex([real]);
    expect(resolveRef(bare, index)).toEqual(real);
  });

  it("leaves an unresolvable reference visible rather than dropping it", () => {
    expect(resolveRef(bare, new Map())).toEqual(bare);
  });

  it("does not resolve a reference to another bare reference", () => {
    const index = buildNodeIndex([bare]);
    expect(resolveRef(bare, index)).toEqual(bare);
  });
});

describe("images", () => {
  const index = buildNodeIndex([
    { "@id": "#img", "@type": "ImageObject", url: "https://cdn.example.com/pie.jpg" },
  ]);

  it("follows a reference instead of downloading the pointer", () => {
    // regression: fetching the @id yields a 404 or an HTML page
    expect(parseImageUrl({ "@id": "#img" }, index, "https://example.com/")).toBe(
      "https://cdn.example.com/pie.jpg",
    );
  });

  it("reads a plain string", () => {
    expect(parseImageUrl("https://cdn.example.com/a.jpg", index, "https://example.com/")).toBe(
      "https://cdn.example.com/a.jpg",
    );
  });

  it("resolves a relative path against the page", () => {
    expect(parseImageUrl("/img/a.jpg", index, "https://example.com/recipes/pie")).toBe(
      "https://example.com/img/a.jpg",
    );
  });

  it("takes the first usable entry from an array", () => {
    expect(
      parseImageUrl(
        [{ "@id": "#missing" }, "https://cdn.example.com/b.jpg"],
        index,
        "https://example.com/",
      ),
    ).toBe("https://cdn.example.com/b.jpg");
  });

  it("reads contentUrl when there is no url", () => {
    expect(
      parseImageUrl(
        { "@type": "ImageObject", contentUrl: "https://cdn.example.com/c.jpg" },
        index,
        "https://example.com/",
      ),
    ).toBe("https://cdn.example.com/c.jpg");
  });

  it("returns null rather than a data URI it cannot fetch", () => {
    expect(parseImageUrl("data:image/png;base64,AA", index, "https://example.com/")).toBeNull();
  });
});

describe("durations", () => {
  it("reads ISO 8601", () => {
    expect(durationToMinutes("PT1H20M")).toBe(80);
    expect(durationToMinutes("PT45M")).toBe(45);
    expect(durationToMinutes("PT2H")).toBe(120);
    expect(durationToMinutes("P1DT2H")).toBe(1560);
  });

  it("reads the plain text some sites put in a duration field", () => {
    expect(durationToMinutes("1 hour 30 minutes")).toBe(90);
    expect(durationToMinutes("25 mins")).toBe(25);
  });

  it("returns null rather than zero for nothing usable", () => {
    for (const value of [undefined, "", "PT0M", "soon", null]) {
      expect(durationToMinutes(value as never), String(value)).toBeNull();
    }
  });
});

describe("servings", () => {
  it("reads every shape a yield is written in", () => {
    expect(parseServings(4)).toBe(4);
    expect(parseServings("4")).toBe(4);
    expect(parseServings("4 servings")).toBe(4);
    expect(parseServings(["4", "4 servings"])).toBe(4);
    expect(parseServings("Serves 6")).toBe(6);
  });

  it("takes the upper bound of a range, so nobody is left short", () => {
    expect(parseServings("Serves 6-8")).toBe(8);
    expect(parseServings("4 to 6")).toBe(6);
  });

  it("returns null when there is no number", () => {
    expect(parseServings("a crowd")).toBeNull();
    expect(parseServings(undefined)).toBeNull();
  });
});

describe("steps", () => {
  it("reads an array of HowToStep", () => {
    expect(
      parseSteps([
        { "@type": "HowToStep", text: "Chop the onion." },
        { "@type": "HowToStep", text: "Fry it." },
      ]),
    ).toEqual(["Chop the onion.", "Fry it."]);
  });

  it("descends into sections rather than treating a heading as a step", () => {
    expect(
      parseSteps([
        {
          "@type": "HowToSection",
          name: "For the crust",
          itemListElement: [{ "@type": "HowToStep", text: "Rub in the butter." }],
        },
        { "@type": "HowToStep", text: "Bake." },
      ]),
    ).toEqual(["Rub in the butter.", "Bake."]);
  });

  it("splits a single blob into lines", () => {
    expect(parseSteps("Chop the onion.\nFry it.\n\nServe.")).toEqual([
      "Chop the onion.",
      "Fry it.",
      "Serve.",
    ]);
  });

  it("strips markup that survived into the text", () => {
    expect(parseSteps(["<p>Chop the <b>onion</b>.</p>"])).toEqual(["Chop the onion."]);
  });

  it("returns an empty list rather than a phantom step", () => {
    expect(parseSteps(undefined)).toEqual([]);
    expect(parseSteps([])).toEqual([]);
    expect(parseSteps("   ")).toEqual([]);
  });
});
