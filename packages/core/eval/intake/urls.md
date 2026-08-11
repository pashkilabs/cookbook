# Recipe URLs

One per line. A note on what's awkward about it saves re-deriving it later.

## Candidates — replace these with your own

These are mine, not yours, and that's the weakness: they're real pages but not
the recipes your household actually cooks. Keep the ones that are useful, bin
the rest.

Each was fetched and checked for structured data, so the tier is measured rather
than assumed.

| URL | Tier 0? | Why it's worth having |
|---|---|---|
| https://www.budgetbytes.com/creamy-tomato-spinach-pasta/ | yes — JSON-LD `Recipe` | Prices inside the ingredient lines: `½ lb penne pasta ($0.49)`, `1  yellow onion (small dice, 340g, 1.5 cups, $0.78)`. Vulgar fractions, a double space, and three competing measures in one parenthetical. |
| https://www.budgetbytes.com/marry-me-chicken-pasta/ | yes — JSON-LD `Recipe` | Same house style, different dish — checks that the parenthetical handling isn't fitted to one page. |
| https://www.halfbakedharvest.com/gochujang-butter-pasta/ | yes — JSON-LD `Recipe` | Chatty ingredient prose; brand names in the lines. |
| https://pinchofyum.com/creamy-garlic-sun-dried-tomato-pasta | yes — JSON-LD `Recipe` | Sectioned ingredients on the page. |
| https://www.food.com/recipe/rib-sauce-415768 | yes — two `Recipe` nodes | User-submitted, so amounts are inconsistent. Two `Recipe` nodes in one page is the interesting part: tier 0 has to pick one. |

## Gaps worth filling deliberately

Everything above is a tier-0 hit, which makes it a weak eval set — it measures
the easy path only. Worth adding:

- **A page with no structured data.** `cooks.com` recipe pages look right for
  this (plain HTML, community-submitted, no recipe plugin), but it rate-limited
  the check with a `429` before the markup could be confirmed. That rate
  limiting is itself worth knowing about for the import service.
- **A page where the recipe is in prose**, not a list — older personal blogs and
  newspaper archives.
- **A recipe with an ingredient table** rather than a list.
- **A paywalled or consent-walled page**, to fix what the failure looks like.

## Already known to be a dead end

Facebook, Instagram and TikTok links don't resolve — see `CLAUDE.md`. Those
belong in `captions/` or `screenshots/`, not here.

## A "what does correct mean" question these raise

Budget Bytes writes `1  yellow onion (small dice, 340g, 1.5 cups, $0.78)`. The
parenthetical holds a weight, a volume and a price for one onion. The expected
output has to commit to one reading:

- `{amount: 1, unit: null, item: "yellow onion"}` — trust the count, drop the rest
- `{amount: 340, unit: "g", item: "yellow onion"}` — trust the stated weight

The second is better for the shopping list, since 340 g consolidates and "1
onion" doesn't. The first is what the parser does today. This is your call, not
the parser's, and it should be settled before the expected outputs are written —
it changes what "correct" means for every page in this house style.
