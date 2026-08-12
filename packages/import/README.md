# @pashki/import

Server-side recipe import. Deterministic tiers first; a model only when they find nothing.

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

| Tier | Reads | Cost |
|---|---|---|
| `structured-data` | the machine-readable recipe data the page publishes | free |
| `microdata` | `itemprop` attributes and recipe-plugin markup | free |
| `llm` | a model over the page's text, schema-constrained | ¢ |
| `vision` | a vision model over user-supplied screenshots, fused | ¢¢ |

The deterministic tiers are more accurate than a model, because they read what the
site said rather than interpreting it (decisions §6). **Deterministic before AI is
the control flow here, not a preference:** tier 2 only runs when the first two found
nothing, and only when a cascade is passed in. `importRecipe` with no `llm` option
calls no model at all.


## Tier 2 is structured, not tuned

**Nothing here is tuned and no production model is chosen.** Both are measurements,
and the eval set has three placeholder fixtures. `PLACEHOLDER_CASCADE` exists to
make the cascade runnable and is **not a recommendation** — the names come from the
routing table in decisions §7, which is itself an August 2026 snapshot due for
re-benchmarking.

What *is* decided:

**Schema-constrained output, enforced by the provider.** `LlmRequest.responseSchema`
is not a suggestion in a prompt — a provider is required to use its structured-output
mode. A prompt asking politely for JSON produces prose apologies at the worst
moment, and the point of tier 2 is output a machine can check.

**We validate anyway.** `validateRecipePayload` re-checks the output in our own code,
because a structured-output mode that silently degrades, a proxy that rewrites a
response, or a provider having a bad day all produce something close enough to cause
damage. That check is what decides escalation.

**Escalation is on validation failure only** — not on a low-confidence feeling and
not a retry loop. That is what makes running cheap models safe: there is a
machine-checkable signal for when one was not good enough.

**The model returns verbatim ingredient lines; `packages/core` parses them.** Core's
parser is already tested against `1 (14.5 oz) can`, `2 to 3 cloves` and `T` versus
`t`; a model re-deriving that is a second implementation to keep honest. It also means
all three tiers produce ingredients through the same code, so an eval comparison
between tiers measures extraction rather than two different parsers. Whether that is
the right split is exactly what the fixtures are for.

**A model is never asked for an image URL.** It would invent a plausible one, and a
wrong photo on somebody's recipe is worse than none. Even when tier 2 wrote the text,
the image comes from the page's markup.

**Every tier attempt is recorded** on the outcome, including the ones that found
nothing, so the harness can report which tier answered and what the cheaper ones did.
That hit rate is the cost lever, and it cannot be reported if the cascade only returns
its winner.

## Tier 3: screenshots, fused

```ts
const outcome = await importFromImages(frames, {
  cascade,                                    // needs cascade.visionModels
  preparer: createSharpImagePreparer(),       // from @pashki/import/sharp
});
```

Same provider interface as tier 2 — `LlmRequest.images` is the only difference, so a
vision model is a **config value** (`cascade.visionModels`) and not a second code
path. Also not tuned, and `PLACEHOLDER_VISION_CASCADE` is not a recommendation.
Vision is the weakest link in the cascade (decisions §7): stylised text over food is
materially harder than document OCR, and a phone screenshot of a reel is the worst
input in the product. Expect fixtures to show it.

**Every frame goes in one call.** A reel splits its recipe across the on-screen card,
the caption and a pinned comment, so fusing them *is* the task. Three separate
extractions produce three partial recipes and leave the merge to code that cannot see
the pictures.

**Estimated amounts are a first-class field.** Reels say "a splash of cream", so the
schema asks per ingredient whether the amount was read or inferred, and a true flag
becomes `estimated` on the parsed ingredient — which is already a column
(`recipe_ingredients.is_estimated`). A note would be prose nobody queries; a boolean
can be a filter and a visible marker on the review screen.

Lines are parsed **one at a time** rather than through `parseIngredientList`, because
that discards lines it cannot read and every following flag would shift onto the wrong
ingredient. A misplaced "we guessed this" marker is worse than none — it tells someone
a number is trustworthy when it is not.

**The model chooses the dish photo, by index.** This is the one case where it may
choose an image, because it is selecting among images the *user supplied* rather than
inventing a URL. An out-of-range or non-integer index becomes no photo rather than a
wrong one.

**Downscaled before sending.** Pixels above a vision model's tile ceiling are paid for
and then discarded. `createSharpImagePreparer` resizes to the longest-edge limit and
re-encodes as JPEG; the passthrough preparer validates and **rejects** oversized
images with a reason rather than forwarding them. Note that byte reduction is
content-dependent — a small, highly regular PNG can re-encode to a larger JPEG — so
what is guaranteed is the dimension and byte ceilings, not "always smaller".

**Not cached.** The cache is keyed by URL hash and screenshots have none. Keying by
image content would mean a shared table whose keys reveal that two households hold the
same screenshot, for a hit rate near zero — everyone's crop differs.

## Driving it from the eval harness

```ts
const extractor = createImportExtractor({ fetcher, cache, llm });
// then hand it to runEval() from @pashki/core/eval
```

`url` fixtures run the whole cascade; `caption` fixtures go straight to tier 2, which
is the path it exists for; `screenshot` fixtures run tier 3 over every frame they list.
Null is returned only when a tier cannot be attempted at all — no cascade configured,
no image loader, or a missing fixture file — so the harness records a skip rather than
scoring zero against something that was never wired up.

The screenshot fixture kind gained `extraImagePaths`, because a fixture with one image
cannot measure fusion and fusion is the thing tier 3 does.

**Server-only**, and enforced: a browser cannot fetch other websites, the cache needs
the service role, and an inference key must never reach a client bundle.
`scripts/check-server-only.mjs` fails the build if this package is imported from a
`"use client"` file or from `apps/mobile`.

## Storing an imported photo

```ts
const stored = await storeImportedPhoto(
  { familyId, bytes: outcome.photo.bytes },
  { supabase: serviceRoleClient },        // from @pashki/import/photo-storage
);
// stored.storagePath goes in photos.storage_path when the user accepts the review
```

Resized once on ingest to a 1600px longest edge and re-encoded as JPEG; display sizes
come from Supabase's image transformation CDN on read, so storing four crops of every
photo would be paying twice. EXIF is dropped — a photo lifted off a page can carry a
location and a camera serial.

**It does not insert the `photos` row.** No import saves without the user seeing it, so
the row is written when they accept — and because every storage policy resolves through
`photos.storage_path`, an object with no row is readable by nobody but the service
role. An abandoned import leaves an unreachable object rather than a visible one, and
the review screen gets at its picture through a short-lived signed URL
(`createReviewPhotoUrl`).

The bucket is **private**, which is the load-bearing part: a public Supabase bucket
serves every object to anyone with the URL and bypasses row-level security entirely,
so the policies would exist and decide nothing. The migration asserts it.

Read access mirrors the `photos` table by consulting the same row rather than
restating its conditions — a household sees its own, and anon sees a photo only when
the recipe is published *and* `source = 'camera'`. There are **no client write
policies**: objects arrive via the service role, and camera upload is a Phase 3
concern that will need a policy written deliberately.

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
