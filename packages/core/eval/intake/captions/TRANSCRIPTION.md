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

**Seventeen, not fourteen.** The paste contains seventeen distinct captions. Two
pairs arrived run together, split here at Facebook's "See less" boundary:
pad thai / chile lime bowl, and street corn bowls / crispy rice salad. If three
of these were not meant to be fixtures, say which.

**`facebook-sweet-chilli-crispy-rice-salad.txt` was truncated in the paste**, mid
hashtag. The recipe itself is complete — ingredients, method and macros all
arrived — so it is usable, but the tail is missing.

**Two are not recipes in the sense the harness means**, and are candidate
refusals rather than candidate recipes (decisions §46):

- `instagram-summer-toast-board.txt` — three toast *ideas* with no quantities on
  most components. Arguably `no-recipe-in-source`, arguably a recipe with almost
  every amount null. Worth deciding deliberately: it is the honest hard case.
- `instagram-texas-twinkies.txt` — a method with no quantities at all
  (`Shred cheddar cheese to your desire`, `half a block of cream cheese`).

Several others gate the *link* behind a comment — "comment 'recipe' and I'll DM
you" — while still printing the full ingredient list. Those are recipes: the
withholding is of the blog link, not of the recipe. Only a caption withholding
the **ingredients** is `no-recipe-in-source`.
