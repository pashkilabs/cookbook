import type { FetchedBytes, FetchedPage, Fetcher, ImportCache, ExtractedRecipe } from "../src/index.js";

/** A fetcher over a fixed map of URLs, so no test touches the network. */
export function createFakeFetcher(
  pages: Record<string, Partial<FetchedPage> & { html: string }>,
  images: Record<string, Partial<FetchedBytes> & { bytes: Uint8Array }> = {},
): Fetcher & { pageCalls: string[]; byteCalls: string[] } {
  const pageCalls: string[] = [];
  const byteCalls: string[] = [];
  return {
    pageCalls,
    byteCalls,
    async page(url) {
      pageCalls.push(url);
      const found = pages[url];
      if (!found) throw new Error(`no fixture page for ${url}`);
      return {
        finalUrl: found.finalUrl ?? url,
        contentType: found.contentType ?? "text/html; charset=utf-8",
        html: found.html,
      };
    },
    async bytes(url) {
      byteCalls.push(url);
      const found = images[url];
      if (!found) throw new Error(`no fixture image for ${url}`);
      return {
        finalUrl: found.finalUrl ?? url,
        contentType: found.contentType ?? "image/jpeg",
        bytes: found.bytes,
      };
    },
  };
}

export function createFakeCache(): ImportCache & { store: Map<string, ExtractedRecipe>; gets: string[]; puts: string[] } {
  const store = new Map<string, ExtractedRecipe>();
  const gets: string[] = [];
  const puts: string[] = [];
  return {
    store,
    gets,
    puts,
    async get(urlHash) {
      gets.push(urlHash);
      return store.get(urlHash) ?? null;
    },
    async put(urlHash, recipe) {
      puts.push(urlHash);
      store.set(urlHash, recipe);
    },
  };
}

/** A real, decodable 64×48 JPEG: SOI, APP0, SOF0 with dimensions, SOS, EOI. */
export function jpegBytes(width = 64, height = 48): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    // APP0 segment we must skip over to reach the SOF
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    // a comment segment, so the walk has to skip twice
    0xff, 0xfe, 0x00, 0x04, 0x61, 0x62,
    // SOF0: length, precision, height, width, components
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0xff, 0xd9,
  ]);
}

/** A real PNG header: magic plus an IHDR carrying the dimensions. */
export function pngBytes(width = 100, height = 80): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff], 16);
  bytes.set(
    [(height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff],
    20,
  );
  return bytes;
}

export function gifBytes(width = 64, height = 64): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  bytes.set([width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff], 6);
  return bytes;
}

/** What a proxy hands back while claiming image/jpeg. */
export const HTML_PRETENDING_TO_BE_AN_IMAGE = new TextEncoder().encode(
  "<!doctype html><html><body>404 Not Found</body></html>",
);

/**
 * A page in the shape real recipe sites publish: the image is a reference into the
 * graph, and the ImageObject it points at is defined in a separate node — after the
 * reference, which is the ordering that breaks a naive index.
 */
export const PAGE_WITH_IMAGE_REFERENCE = `<!doctype html>
<html><head>
<meta property="og:site_name" content="Example Blog">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://example.com/pie/#webpage",
      "primaryImageOfPage": { "@id": "https://example.com/pie/#primaryimage" }
    },
    {
      "@type": "Recipe",
      "@id": "https://example.com/pie/#recipe",
      "name": "Apple Pie",
      "recipeYield": "Serves 6-8",
      "totalTime": "PT1H20M",
      "image": { "@id": "https://example.com/pie/#primaryimage" },
      "recipeIngredient": [
        "2 cups all-purpose flour",
        "1 \\u00bd cups sugar",
        "1 (14.5 ounce) can sliced apples, drained"
      ],
      "recipeInstructions": [
        { "@type": "HowToSection", "name": "Crust", "itemListElement": [
          { "@type": "HowToStep", "text": "Rub the butter into the flour." }
        ]},
        { "@type": "HowToStep", "text": "Bake for 40 minutes." }
      ]
    },
    {
      "@type": "ImageObject",
      "@id": "https://example.com/pie/#primaryimage",
      "url": "https://cdn.example.com/pie.jpg",
      "width": 1200,
      "height": 800
    }
  ]
}
</script>
</head><body></body></html>`;

/** Microdata only: no ld+json anywhere, a WP Recipe Maker card. */
export const PAGE_WITH_MICRODATA = `<!doctype html>
<html><head>
<meta property="og:site_name" content="Plugin Blog">
<meta property="og:image" content="/images/stew.png">
</head><body>
<h1>Beef Stew</h1>
<div class="wprm-recipe">
  <h2 class="wprm-recipe-name">Beef Stew</h2>
  <span class="wprm-recipe-servings">4</span>
  <meta itemprop="totalTime" content="PT45M">
  <ul>
    <li class="wprm-recipe-ingredient">2 lbs beef chuck, cubed</li>
    <li class="wprm-recipe-ingredient">3 carrots, sliced</li>
    <li class="wprm-recipe-ingredient">1 cup red wine</li>
  </ul>
  <div class="wprm-recipe-instruction-text">Brown the beef.</div>
  <div class="wprm-recipe-instruction-text">Simmer for two hours.</div>
</div>
</body></html>`;

export const PAGE_WITH_NO_RECIPE = `<!doctype html>
<html><head><title>About us</title></head>
<body><p>We are a company.</p></body></html>`;
