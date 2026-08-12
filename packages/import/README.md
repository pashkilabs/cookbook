# @pashki/import

Server-side recipe import. **Deterministic tiers only** — no model calls.

```ts
const outcome = await importRecipe(url, {
  fetcher: createHttpFetcher(),
  cache: createSupabaseImportCache(serviceRoleClient),
});

if (outcome.ok) {
  outcome.recipe;   // title, servings, totalMinutes, ingredients, steps, attribution
  outcome.photo;    // decoded bytes + real dimensions, or null
  outcome.tier;     // which tier answered
  outcome.fromCache;
} else {
  outcome.failure;  // a typed reason, never an exception
}
```

| Tier | Reads |
|---|---|
| `structured-data` | the machine-readable recipe data the page publishes |
| `microdata` | `itemprop` attributes and recipe-plugin markup |

Both are free, instant and more accurate than a model, because they read what the
site said rather than interpreting it (decisions §6). Tiers 2 (LLM over page text)
and 3 (vision) plug in behind the same `ImportOutcome` and **cannot be judged until
the eval set has real fixtures** — the harness exists, the fixtures don't.

**Server-only.** A browser cannot fetch other websites, and the cache needs the
service role.

## Failures are values

Every failure is a variant of `ImportFailure`, not an exception. Each one is
something a review screen has to explain to a person, and a `catch` block has
already lost the detail that makes it explicable:

| kind | means |
|---|---|
| `invalid-url` | not a fetchable http(s) URL |
| `blocked-platform` | Facebook, Instagram or TikTok, with `useInstead: "screenshot" \| "video"` |
| `fetch-failed` | the request failed, with the reason |
| `not-html` | the response was not a web page |
| `no-recipe-found` | every tier tried, none fired, with `triedTiers` |
| `recipe-incomplete` | a tier fired but the result was unusable, with `missing` |

A **bad image is not a failed import**: the recipe comes back with `photo: null`.

## What the prototype learned, kept

**Image fields are references, not URLs.** Recipe data routinely writes
`"image": {"@id": "…#primaryimage"}` and defines the real `ImageObject` in a
separate node. The reference is followed; the pointer is never downloaded.

**A bare reference must not overwrite the node it points at.** Both appear in the
graph, and if the reference happens to come second, a naive index maps the id to an
object containing nothing but that id — and the image silently disappears.
`buildNodeIndex` keeps the richer node regardless of order. There is a regression
test.

**Validate an image by decoding it.** Never by the content type claimed: a proxy
will return `image/jpeg` for an HTML error page, and a CDN will return
`application/octet-stream` for a good JPEG. `decodeImage` parses the container to
recover the real format and dimensions, which also rejects empty and truncated
responses and 1×1 tracking pixels. It is not a full pixel decode — a valid header
with corrupt scan data would pass here and fail in a browser.

Finding a JPEG's dimensions means walking the segment chain: they sit in whichever
`SOF` segment follows however many `APPn` and comment segments the encoder wrote,
so there is no fixed offset to read.

**Facebook, Instagram and TikTok are rejected before a request is made**, with the
route the user should take instead. Four doomed attempts and a timeout is a worse
answer than an immediate one.

## The cache is keyed by URL, not by family

A recipe doing the rounds is fetched and parsed **once for the entire user base**,
which at subscription scale matters more than model choice (architecture §11).

That only works if the key is stable, so URLs are normalised first: tracking
parameters stripped, fragment dropped, `http`/`https` and `www` unified, remaining
parameters sorted, trailing slash removed. The same page shared four ways is one
row — there's a test that fetches once and serves three times from the cache.

The key is `sha256:` of the normalised URL. Hashed rather than stored raw so the
column is a fixed width and holds no readable browsing history. Parameters that
identify a page (`?p=123`) survive normalisation; collapsing those would merge a
whole blog into one entry.

Cached values are validated on the way **out** as well as in. A row written by an
older version of this package is treated as a miss and re-fetched, rather than
surfacing an undefined field deep in a review screen.

A cache write that fails does not fail the import.

## Known limits

**Tier 1 uses regexes, not a DOM.** It cannot handle nesting, so a section heading
inside an ingredient list looks like an ingredient. The ingredient parser already
discards non-ingredients, and adding a DOM dependency to win the remaining cases is
a decision better made against real fixtures than in advance.

**Pages are decoded as UTF-8** regardless of what they declare. Recipe sites still
serving latin-1 exist; the damage is a mangled `é` the review screen can fix, which
is worth less than a charset-detection dependency.

**Section headings in the method are dropped.** `HowToSection` is descended into for
its steps; the heading has nowhere to live in the schema.
