# How these were transcribed

Seventeen files, from a paste of Instagram and Facebook captions on 15 Aug 2026.

## Two things were changed, both deliberately

**Markdown link wrappers were unwrapped to their labels.** The paste arrived with
hashtags and handles as links — `[#peachrecipe](https://.../peachrecipe)`,
`[@kalejunkie](https://www.instagram.com/kalejunkie/)`. No caption contains that;
it is an artefact of copying rendered HTML. Left in, a fixture would be
measuring markdown-link parsing rather than caption reading. Each is unwrapped to
what the caption said: `#peachrecipe`, `@kalejunkie`. Bare URLs in the text are
kept as URLs. Facebook's `__cft__`/`__tn__` tracking parameters went with the
wrappers.

**Nothing else.** Kept, on purpose, because the formatting *is* the fixture:

- typos — `lmeon juice`, `peachesand`, `3 tb fresh fill` (dill), a stray `q` before
  `#padthai`
- the invisible `⁣` (U+2063) Instagram line separators, which are why some captions
  read as one long line
- `��` where the source's emoji did not survive, in `instagram-texas-twinkies.txt`
- trailing post-age markers — `27w`, `Edited · 23w`, `See less`
- vulgar fractions (`½`, `⅓`, `1½`), `tb` vs `tbsp`, `oz.` with the stop
- amounts that are only a gesture: `eyeball some nutmeg`, `2 splashes vanilla`,
  `squeeze of fresh lemon juice (1-2 Tbsp.)`, `Water to thin`

## Three notes for whoever writes the expected output

**Seventeen, not fourteen — all seventeen are fixtures.** Two pairs arrived run
together and are split here at Facebook's "See less" boundary: pad thai / chile
lime bowl, and street corn bowls / crispy rice salad. Confirmed correct.

**`facebook-sweet-chilli-crispy-rice-salad.txt` was truncated in the paste**, mid
hashtag. Only trailing hashtags are lost: ingredients, method and macros all
arrived, so the fixture is usable as it stands.

**Two look like refusals and are not.** Both are recipes, and both are the most
valuable text fixtures in the set (decisions §46):

- `instagram-texas-twinkies.txt` — every ingredient named, every amount absent.
  Expected output is the named ingredients with `amount: null` and **no invented
  quantities**. This is the cleanest measure of whether an extractor fabricates
  when a source declines to specify — the same failure the reel path will have,
  where amounts are spoken aloud and never written.
- `instagram-summer-toast-board.txt` — three toasts as three sections under §45,
  mostly null amounts with a few stated (`2 ears of corn`, `1 block feta`).

The rule behind both, now recorded as decisions §46: a caption withholding a
**link** while printing the ingredients is a recipe. Only a caption withholding
the **ingredients** is `no-recipe-in-source`.
