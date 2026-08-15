# Recipe URLs

Eighteen, as supplied. Thirteen are recipe pages; five are deliberate refusals
(decisions §46). Tier column is a *prediction* until the capture is taken —
`gen` the fixtures and the harness will say what actually answered.

## Recipe pages (13)

| # | URL | expected tier | why it's worth having |
|---|---|---|---|
| 1 | https://smittenkitchen.com/2026/05/chicken-salad-for-celery-enthusiasts/ | 0? | Long-form prose blog. Smitten Kitchen writes amounts inside sentences; check whether a `Recipe` node exists at all. |
| 2 | https://pinchofyum.com/saucy-gochujang-noodles-with-chicken | 0 | Sectioned ingredients on the page — a §45 case. |
| 3 | https://www.bbcgoodfood.com/recipes/summer-roast-chicken-traybake | 0 | UK metric, units closed up against the number (`150ml`) — the form that defeated the parser until 15 Aug. |
| 4 | https://www.recipetineats.com/mediterranean-baked-chicken-dinner/ | 0 | Dual US/metric in one line. |
| 5 | https://www.recipetineats.com/chicken-breast-recipe/ | 0 | Same house style, different dish — checks the handling isn't fitted to one page. |
| 6 | https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/ | 0 | Prices inside the ingredient lines: `($0.49)`. Vulgar fractions and three competing measures in one parenthetical. |
| 7 | https://smittenkitchen.com/2020/09/crispy-tortellini-with-peas-and-prosciutto/ | 0? | Older post — the plugin markup may predate the current one. |
| 8 | https://www.seriouseats.com/easy-pan-seared-chicken-breasts-pan-sauce-recipe | 0 | Technique-led; weights in grams beside volumes. |
| 9 | https://www.jamieoliver.com/recipes/chicken-recipes/hit-n-run-traybake/ | 0 | `1 x 1.5kg free-range whole chicken` — the British multiplier form. Two of these already reached production badly parsed (§44). |
| 10 | https://cooking.nytimes.com/recipes/1017532-tomato-jam | 0 | Paywalled. Whether the markup survives the paywall is the measurement. |
| 11 | https://www.americastestkitchen.com/recipes/11322-crispy-skin-pan-seared-chicken-breasts | 1? | Hard paywall, likely no `Recipe` node to anonymous fetch. |
| 12 | https://tasty.co/recipe/one-pot-creamy-chicken-and-mushroom-pasta | 0 | Video-first site; ingredients often in a component rather than JSON-LD. |
| 13 | https://cookpad.com/us/recipes/14561234-easy-homemade-chicken-curry | 0? | User-submitted, so amounts are inconsistent and units are informal. |

## Deliberate refusals (5)

The correct output is a refusal naming why, **not** a plausible recipe. A recipe
invented for any of these is a confabulation and is reported as one.

| # | URL | reason | reading |
|---|---|---|---|
| 14 | https://www.meallime.com/recipes | `not-a-recipe-page` | An index of recipes, not a recipe. Nothing to offer — the URL is the wrong one. |
| 15 | https://www.tiktok.com/@gordonramsayofficial/video/7036666579843640582 | `unresolvable-source` | Never resolves server-side (CLAUDE.md). Offer the screenshot or video route. |
| 16 | https://www.instagram.com/p/C-Xy1z3M-AB/ | `unresolvable-source` | Same. Reject up front rather than after four doomed attempts. |
| 17 | https://www.reddit.com/r/recipes/comments/1vk9733/what_are_the_best_recipes_on_a_grill/ | `not-a-recipe-page` | The slug settles it: *what are the best recipes on a grill* is a question thread soliciting suggestions, not a post containing a recipe. See the note below. |
| 18 | https://archive.org/details/cbk_community-cookbook-archive | *see below* | The identifier reads as a **collection** (`cbk_community-cookbook-archive`), not a single scanned book. Unresolved — see below. |

### Two readings that needed checking, not accepting

**17, the Reddit thread — confirmed `not-a-recipe-page`.** Reddit threads often
*do* carry a full recipe in the post body, and refusing one of those would be a
false refusal, which is the worse failure: the recipe was right there. This one
is safe because the slug is a question — `what_are_the_best_recipes_on_a_grill`
— so the body solicits suggestions rather than stating a recipe. Worth
re-checking against the live thread when the capture is taken; if the top post
turns out to contain a full recipe, this fixture becomes a recipe fixture.

**18, the archive.org item — still open.** The supplied reading was
`not-a-recipe-page`, and that is right *if* the page is a collection index. But
if it is a scanned cookbook page, the honest answer is `image-only-source`: the
recipe is genuinely there and genuinely a picture, the text tiers cannot read it,
and the vision tier can. `not-a-recipe-page` would route somebody to nothing
when a working path exists. The identifier suggests a collection, which would
make it `not-a-recipe-page`, but that is inference from a slug and the capture
will settle it.

---

## Capture results, 15 Aug 2026

Seven of the thirteen recipe URLs carry a JSON-LD `Recipe` node. Three are dead,
two are live but refuse a server-side fetch, one serves the wrong recipe's markup.
Full readings and every ambiguity in `EXPECTED-DRAFT.md`.

| # | HTTP | tier 0? | note |
|---|---|---|---|
| 1 smittenkitchen chicken-salad | 200 | no | markup only — tier 1 |
| 2 pinchofyum gochujang | 200 | yes | sections on the page, not in the JSON-LD |
| 3 bbcgoodfood traybake | 200 | yes | `2 x 400g cans`, `1 ½kg` |
| 4 recipetineats mediterranean | 200 | yes | dual units; `1/2 tsp EACH salt and pepper` |
| 5 recipetineats chicken-breast | 200 | yes | no `totalTime`, only prep + cook |
| 6 budgetbytes pesto pasta | 200 | yes | prices in every line |
| 7 smittenkitchen tortellini | **404** | — | **dead URL** |
| 8 seriouseats | **402** | — | live, refuses a server fetch |
| 9 jamieoliver hit-n-run-traybake | **404** | — | **dead URL**, on both path forms |
| 10 nytimes tomato jam | 200 | yes | yield is `1 pint`, not a serving count |
| 11 americastestkitchen | 200 | ⚠ | **markup is a different recipe** — mushrooms, not chicken |
| 12 tasty.co | **406** | — | live, refuses a server fetch |
| 13 cookpad chicken curry | **404** | — | **dead URL** |
| 18 archive.org | **404** | — | identifier does not exist; the refusal reason cannot be read off a page that is not there |

**Tier-0 hit rate: 7/13 as supplied (54%)**, 7/10 of those that resolve, 7/8 of
those returning HTML. The first is the number that matters to somebody pasting a
link, because a dead link is a failed import whatever the cause.
